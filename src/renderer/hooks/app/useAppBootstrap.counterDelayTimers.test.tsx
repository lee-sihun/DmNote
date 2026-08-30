import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getKeyCounterSignal,
  setKeyCounter,
} from '@stores/signals/keyCounterSignals';
import { useSettingsStore } from '@stores/useSettingsStore';
import type { BootstrapPayload } from '@src/types/app';
import type { KeyCounters } from '@src/types/key/keys';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface MockKeyState {
  selectedKeyType: string;
  isBootstrapped: boolean;
  customTabs: unknown[];
  tabOrder?: string[];
  barCount?: number;
}

type MockKeyStoreListener = (
  state: MockKeyState,
  previousState: MockKeyState,
) => void;

const mocks = vi.hoisted(() => ({
  counterChangedListener: null as null | ((payload: unknown) => void),
  countersChangedListener: null as null | ((payload: unknown) => void),
  counterStateListener: null as null | ((payload: unknown) => void),
  counterSessionId: 'session-a',
  counterRevision: 0,
  modeChangedListener: null as null | ((payload: unknown) => void),
  resyncListener: null as null | (() => void),
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
    getState: vi.fn(() => ({
      ...mocks.keyState,
      // keys:mode-changed 수신부가 쓴다. 선택만 바꾸는 실제 동작을 흉내 낸다
      commitSelectedKeyType: (selectedKeyType: string) => {
        const previousState = mocks.keyState;
        mocks.keyState = { ...previousState, selectedKeyType };
        mocks.keyStoreListeners.forEach((listener) => {
          listener(mocks.keyState, previousState);
        });
      },
      adoptTabMetadataEvent: ({
        customTabs,
        tabOrder,
        barCount,
        selectedKeyType,
        selectionAuthoritative,
      }: {
        customTabs: unknown[];
        tabOrder: string[];
        barCount: number;
        selectedKeyType: string;
        selectionAuthoritative: boolean;
      }) => {
        const previousState = mocks.keyState;
        mocks.keyState = {
          ...previousState,
          customTabs,
          tabOrder,
          barCount,
          selectedKeyType: selectionAuthoritative
            ? selectedKeyType
            : previousState.selectedKeyType,
        };
        mocks.keyStoreListeners.forEach((listener) => {
          listener(mocks.keyState, previousState);
        });
      },
    })),
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
  useStatItemStore: {
    getState: vi.fn(() => ({ positions: {} })),
    setState: vi.fn(),
  },
}));
vi.mock('@stores/data/useGraphItemStore', () => ({
  useGraphItemStore: {
    getState: vi.fn(() => ({ positions: {} })),
    setState: vi.fn(),
  },
}));
vi.mock('@stores/data/useKnobItemStore', () => ({
  useKnobItemStore: {
    getState: vi.fn(() => ({ positions: {} })),
    setState: vi.fn(),
  },
}));
vi.mock('@stores/data/useLayerGroupStore', () => ({
  useLayerGroupStore: {
    getState: vi.fn(() => ({
      layerGroups: {},
      setLayerGroups: vi.fn(),
    })),
  },
}));
vi.mock('@stores/useFontStore', () => ({
  useFontStore: { getState: vi.fn(() => ({})), setState: vi.fn() },
  syncFontCSS: vi.fn(),
}));
vi.mock('@api/pluginDisplayElements', () => ({
  getUndoRedoInProgress: vi.fn(() => false),
}));
vi.mock('@api/modules/obsApi', () => ({
  obsApi: {
    onResync: vi.fn((listener: () => void) => {
      mocks.resyncListener = listener;
      return vi.fn();
    }),
  },
}));
vi.mock('@api/modules/shared', () => ({
  notifyLocaleChanged: vi.fn(),
  subscribe: vi.fn((event: string, listener: (payload: unknown) => void) => {
    if (event === 'keys:counters-state') {
      mocks.counterStateListener = listener;
    }
    return vi.fn();
  }),
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
vi.mock('@api/modules/panelWindowApi', () => ({
  panelWindowApi: {
    onVisibility: vi.fn(() => vi.fn()),
    onCloseRequested: vi.fn(() => vi.fn()),
    takeRestoreRequest: vi.fn(() => Promise.resolve(false)),
    ackClose: vi.fn(() => Promise.resolve(true)),
  },
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
  flushFocusedEditor: vi.fn(),
}));
vi.mock('@src/renderer/editor/runtime/historyEditorFlushLock', () => ({
  acquireHistoryEditorFlushLock: vi.fn(),
  releaseHistoryEditorFlushLock: vi.fn(),
  resetHistoryEditorFlushLock: vi.fn(),
}));
vi.mock('@src/renderer/defaults', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@src/renderer/defaults')>()),
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
  initializeCursorSystem: vi.fn(() => Promise.resolve()),
  refreshCursorSettings: vi.fn(() => Promise.resolve()),
}));

import { useAppBootstrap } from './useAppBootstrap';

const Harness = () => {
  useAppBootstrap();
  return null;
};

const makeBootstrap = (
  keyCounters: KeyCounters = {
    '4key': { KeyK: 0 },
    '8key': { KeyL: 0 },
  },
  keyDisplayDelayMs = 30000,
  keyCountersRevision = mocks.counterRevision,
  keyCountersSessionId = mocks.counterSessionId,
) => {
  const state = useSettingsStore.getState();
  const settings = {
    hardwareAcceleration: state.hardwareAcceleration,
    alwaysOnTop: state.alwaysOnTop,
    overlayLocked: state.overlayLocked,
    angleMode: state.angleMode,
    noteEffect: state.noteEffect,
    noteSettings: { ...state.noteSettings, keyDisplayDelayMs },
    fontSettings: state.fontSettings,
    useCustomCSS: state.useCustomCSS,
    customCSS: {
      content: state.customCSSContent,
      path: state.customCSSPath,
    },
    useCustomJS: state.useCustomJS,
    customJS: { path: null, content: '', plugins: state.jsPlugins },
    backgroundColor: state.backgroundColor,
    language: state.language,
    laboratoryEnabled: state.laboratoryEnabled,
    developerModeEnabled: state.developerModeEnabled,
    trayEnabled: state.trayEnabled,
    autoUpdateEnabled: state.autoUpdateEnabled,
    overlayResizeAnchor: state.overlayResizeAnchor,
    keyCounterEnabled: state.keyCounterEnabled,
    gridSettings: state.gridSettings,
    shortcuts: state.shortcuts,
    obsModeEnabled: state.obsModeEnabled,
  };

  return {
    settings,
    defaults: { settings, counterSettings: {} },
    keys: {},
    positions: {},
    statPositions: {},
    graphPositions: {},
    knobPositions: {},
    customTabs: [],
    tabOrder: ['4key', '5key', '6key', '8key'],
    barCount: 4,
    selectedKeyType: '4key',
    currentMode: '4key',
    activeKeys: [],
    overlay: { visible: true, locked: false, anchor: 'top-left' },
    keyCounters,
    keyCountersSessionId,
    keyCountersRevision,
    layerGroups: {},
    tabNoteOverrides: {},
    tabCssOverrides: {},
    editorRevision: 0,
  } as unknown as BootstrapPayload;
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
      getAll: vi.fn().mockResolvedValue({}),
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

  const emitCounter = (
    count: number,
    mode = '4key',
    key = 'KeyK',
    revision = mocks.counterRevision + 1,
    sessionId = mocks.counterSessionId,
  ) => {
    act(() => {
      if (mocks.counterSessionId !== sessionId) {
        mocks.counterRevision = 0;
      }
      mocks.counterSessionId = sessionId;
      mocks.counterRevision = Math.max(mocks.counterRevision, revision);
      mocks.counterChangedListener?.({
        mode,
        key,
        count,
        sessionId,
        revision,
      });
    });
  };

  const emitCounterSnapshot = (
    counters: Record<string, Record<string, number>>,
    revision = mocks.counterRevision + 1,
    sessionId = mocks.counterSessionId,
  ) => {
    act(() => {
      if (mocks.counterSessionId !== sessionId) {
        mocks.counterRevision = 0;
      }
      mocks.counterSessionId = sessionId;
      mocks.counterRevision = Math.max(mocks.counterRevision, revision);
      mocks.counterStateListener?.({
        sessionId,
        revision,
        counters,
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
    mocks.counterChangedListener = null;
    mocks.countersChangedListener = null;
    mocks.counterStateListener = null;
    mocks.counterSessionId = 'session-a';
    mocks.counterRevision = 0;
    mocks.modeChangedListener = null;
    mocks.resyncListener = null;
    mocks.keyState = {
      selectedKeyType: '4key',
      isBootstrapped: false,
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
    mocks.bootstrap.mockResolvedValue(makeBootstrap());

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mounted = true;
    await act(async () => {
      root.render(<Harness />);
    });
    expect(mocks.bootstrap).toHaveBeenCalledTimes(1);
    expect(mocks.keyState.isBootstrapped).toBe(true);
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

    emitCounterSnapshot({ '4key': { KeyK: 0 } });

    expect(vi.getTimerCount()).toBe(0);
    expect(transitions).not.toContain(4);
    vi.advanceTimersByTime(30000);
    expect(getKeyCounterSignal('4key', 'KeyK').value).toBe(0);
    unsubscribe();
  });

  it('OBS 재동기화 응답보다 최신인 대기 카운터를 보존한다', async () => {
    const transitions: number[] = [];
    const unsubscribe = getKeyCounterSignal('4key', 'KeyK').subscribe(
      (value) => {
        transitions.push(value);
      },
    );
    transitions.length = 0;
    mocks.bootstrap.mockResolvedValueOnce(
      makeBootstrap({ '4key': { KeyK: 4 } }, 10000, 10),
    );

    await act(async () => {
      mocks.resyncListener?.();
      emitCounter(5, '4key', 'KeyK', 11);
      await Promise.resolve();
    });

    expect(transitions).toEqual([5]);
    expect(getKeyCounterSignal('4key', 'KeyK').value).toBe(5);
    expect(vi.getTimerCount()).toBe(0);
    unsubscribe();
  });

  it('reset이 포함된 OBS 스냅샷이 요청 전 대기 타이머보다 최신이면 타이머를 폐기한다', async () => {
    const transitions: number[] = [];
    const unsubscribe = getKeyCounterSignal('4key', 'KeyK').subscribe(
      (value) => {
        transitions.push(value);
      },
    );
    transitions.length = 0;

    emitCounter(9, '4key', 'KeyK', 9);
    expect(vi.getTimerCount()).toBe(1);
    mocks.bootstrap.mockResolvedValueOnce(
      makeBootstrap({ '4key': { KeyK: 0 } }, 10000, 10),
    );

    await act(async () => {
      mocks.resyncListener?.();
      await Promise.resolve();
    });

    expect(transitions).toEqual([]);
    expect(getKeyCounterSignal('4key', 'KeyK').value).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(30000);
    expect(transitions).toEqual([]);
    unsubscribe();
  });

  it('요청 후 먼저 도착한 delta보다 revision이 높은 OBS reset 스냅샷을 적용한다', async () => {
    mocks.bootstrap.mockResolvedValueOnce(
      makeBootstrap({ '4key': { KeyK: 0 } }, 10000, 12),
    );

    await act(async () => {
      mocks.resyncListener?.();
      emitCounter(5, '4key', 'KeyK', 11);
      await Promise.resolve();
    });

    expect(getKeyCounterSignal('4key', 'KeyK').value).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('같은 키의 bootstrap 이전 타이머만 제거하고 이후 타이머는 보존한다', async () => {
    const transitions: number[] = [];
    const unsubscribe = getKeyCounterSignal('4key', 'KeyK').subscribe(
      (value) => {
        transitions.push(value);
      },
    );
    transitions.length = 0;

    emitCounter(9, '4key', 'KeyK', 9);
    mocks.bootstrap.mockResolvedValueOnce(
      makeBootstrap({ '4key': { KeyK: 0 } }, 30000, 10),
    );

    await act(async () => {
      mocks.resyncListener?.();
      emitCounter(1, '4key', 'KeyK', 11);
      await Promise.resolve();
    });

    expect(transitions).toEqual([]);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(30000);
    expect(transitions).toEqual([1]);
    expect(getKeyCounterSignal('4key', 'KeyK').value).toBe(1);
    unsubscribe();
  });

  it('OBS bootstrap보다 최신인 전체 카운터 이벤트를 보존한다', async () => {
    mocks.bootstrap.mockResolvedValueOnce(
      makeBootstrap({ '4key': { KeyK: 5 } }, 30000, 10),
    );

    await act(async () => {
      mocks.resyncListener?.();
      emitCounterSnapshot({ '4key': { KeyK: 0 } }, 11);
      await Promise.resolve();
    });

    expect(getKeyCounterSignal('4key', 'KeyK').value).toBe(0);
  });

  it('OBS bootstrap이 먼저 도착한 전체 카운터 이벤트보다 최신이면 bootstrap을 적용한다', async () => {
    mocks.bootstrap.mockResolvedValueOnce(
      makeBootstrap({ '4key': { KeyK: 2 } }, 30000, 12),
    );

    await act(async () => {
      mocks.resyncListener?.();
      emitCounterSnapshot({ '4key': { KeyK: 0 } }, 11);
      await Promise.resolve();
    });

    expect(getKeyCounterSignal('4key', 'KeyK').value).toBe(2);
  });

  it('backend 재시작으로 카운터 세션이 바뀌면 낮아진 revision을 새 stream으로 수용한다', async () => {
    emitCounter(9, '4key', 'KeyK', 9, 'session-a');
    expect(vi.getTimerCount()).toBe(1);
    mocks.bootstrap.mockResolvedValueOnce(
      makeBootstrap({ '4key': { KeyK: 0 } }, 10000, 0, 'session-b'),
    );

    await act(async () => {
      mocks.resyncListener?.();
      await Promise.resolve();
    });

    expect(getKeyCounterSignal('4key', 'KeyK').value).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    emitCounter(1, '4key', 'KeyK', 1, 'session-b');
    vi.advanceTimersByTime(9999);
    expect(getKeyCounterSignal('4key', 'KeyK').value).toBe(0);
    vi.advanceTimersByTime(1);
    expect(getKeyCounterSignal('4key', 'KeyK').value).toBe(1);
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
