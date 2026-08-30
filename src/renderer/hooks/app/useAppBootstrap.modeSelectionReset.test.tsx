import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '@stores/useSettingsStore';
import type { BootstrapPayload } from '@src/types/app';
import type { EditorCoordinatorState } from '@src/renderer/editor/runtime/editorCoordinator';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface MockKeyState {
  selectedKeyType: string;
  isBootstrapped: boolean;
  customTabs: unknown[];
  tabOrder?: string[];
  barCount?: number;
  deferredTabPlacement?: { tabOrder: string[]; barCount: number } | null;
}

type MockKeyStoreListener = (
  state: MockKeyState,
  previousState: MockKeyState,
) => void;

interface MockCustomTabsPayload {
  customTabs: unknown[];
  tabOrder: string[];
  barCount: number;
  selectedKeyType: string;
  selectionAuthoritative: boolean;
}

const mocks = vi.hoisted(() => ({
  counterStateListener: null as null | ((payload: unknown) => void),
  customTabsListener: null as null | ((payload: MockCustomTabsPayload) => void),
  presetSnapshotListener: null as null | ((payload: unknown) => void),
  resyncListener: null as null | (() => void),
  bootstrap: vi.fn(),
  syncHistoryStatus: vi.fn(),
  dialogAlert: vi.fn(() => Promise.resolve()),
  editorStateListener: null as null | ((state: EditorCoordinatorState) => void),
  editorState: {
    conflict: null,
    failureKind: null,
    error: null,
  } as EditorCoordinatorState,
  keyState: {
    selectedKeyType: '4key',
    isBootstrapped: true,
    customTabs: [],
    tabOrder: ['4key', '5key', '6key', '8key'],
    barCount: 4,
  } as MockKeyState,
  keyStoreListeners: new Set<MockKeyStoreListener>(),
  adoptTabMetadataEvent: vi.fn<(payload: MockCustomTabsPayload) => void>(),
}));

vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@stores/data/useKeyStore', () => ({
  useKeyStore: {
    getState: vi.fn(() => ({
      ...mocks.keyState,
      adoptTabMetadataEvent: mocks.adoptTabMetadataEvent,
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
    subscribe: vi.fn((listener: (state: EditorCoordinatorState) => void) => {
      mocks.editorStateListener = listener;
      return vi.fn();
    }),
    getState: vi.fn(() => mocks.editorState),
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
// 모드 전환 시 창 로컬 선택을 비운다 - 비어 있지 않을 때만 clearSelection
const clearSelection = vi.fn();
vi.mock('@stores/grid/useGridSelectionStore', () => ({
  useGridSelectionStore: {
    getState: () => ({
      selectedElements: [{ type: 'key', id: 'k1' }],
      selectedGroupIds: [],
      clearSelection,
    }),
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
  syncHistoryStatus: mocks.syncHistoryStatus,
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

const makeBootstrap = () => {
  const state = useSettingsStore.getState();
  const settings = {
    hardwareAcceleration: state.hardwareAcceleration,
    alwaysOnTop: state.alwaysOnTop,
    overlayLocked: state.overlayLocked,
    angleMode: state.angleMode,
    noteEffect: state.noteEffect,
    noteSettings: state.noteSettings,
    fontSettings: state.fontSettings,
    useCustomCSS: state.useCustomCSS,
    customCSS: { content: state.customCSSContent, path: state.customCSSPath },
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
    selectedKeyType: '4key',
    currentMode: '4key',
    activeKeys: [],
    overlay: { visible: true, locked: false, anchor: 'top-left' },
    keyCounters: {},
    keyCountersSessionId: 'session-a',
    keyCountersRevision: 0,
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
      onModeChanged: vi.fn(() => vi.fn()),
      onCountersChanged: vi.fn(() => vi.fn()),
      onCounterChanged: vi.fn(() => vi.fn()),
      customTabs: {
        onChanged: vi.fn(
          (listener: (payload: MockCustomTabsPayload) => void) => {
            mocks.customTabsListener = listener;
            return vi.fn();
          },
        ),
      },
    },
    noteTab: {
      getAll: vi.fn().mockResolvedValue({}),
      onChanged: vi.fn(() => vi.fn()),
      onChangedAll: vi.fn(() => vi.fn()),
    },
    presets: {
      onSnapshot: vi.fn((listener: (payload: unknown) => void) => {
        mocks.presetSnapshotListener = listener;
        return vi.fn();
      }),
    },
    ui: { dialog: { alert: mocks.dialogAlert } },
    overlay: { onLock: vi.fn(() => vi.fn()), onAnchor: vi.fn(() => vi.fn()) },
    css: { onUse: vi.fn(() => vi.fn()), onContent: vi.fn(() => vi.fn()) },
    js: { onUse: vi.fn(() => vi.fn()), onState: vi.fn(() => vi.fn()) },
  } as unknown as Window['api']);

// 백엔드는 customTabs:changed와 preset:snapshot을 keys:mode-changed보다 먼저 보낸다.
// 그 사이 store가 "새 모드 + 옛 index"가 되면 옛 선택이 새 모드 요소로 재해석된다
describe('모드 전환 선택 리셋', () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalApi: Window['api'];
  let originalWindowType: typeof window.__dmn_window_type;
  let originalRuntime: typeof window.__dmn_runtime;

  const snapshotPayload = (selectedKeyType: string) => ({
    customTabs: [],
    selectedKeyType,
    tabNoteOverrides: {},
  });

  const customTabsPayload = (
    selectedKeyType: string,
    selectionAuthoritative = true,
    customTabs: unknown[] = [],
  ): MockCustomTabsPayload => ({
    customTabs,
    tabOrder: ['4key', '5key', '6key', '8key'],
    barCount: 4,
    selectedKeyType,
    selectionAuthoritative,
  });

  const mount = async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<Harness />);
    });
  };

  beforeEach(async () => {
    originalApi = window.api;
    originalWindowType = window.__dmn_window_type;
    originalRuntime = window.__dmn_runtime;
    window.__dmn_window_type = 'main';
    window.__dmn_runtime = 'tauri';
    window.api = makeApiMock();
    mocks.bootstrap.mockReset();
    mocks.syncHistoryStatus.mockClear();
    mocks.customTabsListener = null;
    mocks.presetSnapshotListener = null;
    mocks.dialogAlert.mockClear();
    mocks.editorStateListener = null;
    mocks.editorState = {
      conflict: null,
      failureKind: null,
      error: null,
    } as EditorCoordinatorState;
    mocks.keyState = {
      selectedKeyType: '4key',
      isBootstrapped: false,
      customTabs: [],
    };
    mocks.keyStoreListeners.clear();
    mocks.adoptTabMetadataEvent.mockReset();
    mocks.adoptTabMetadataEvent.mockImplementation(
      ({
        customTabs,
        tabOrder,
        barCount,
        selectedKeyType,
        selectionAuthoritative,
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
    );
    mocks.bootstrap.mockResolvedValue(makeBootstrap());
    clearSelection.mockClear();

    await mount();
    expect(mocks.bootstrap).toHaveBeenCalledTimes(1);
    expect(mocks.syncHistoryStatus).toHaveBeenCalledTimes(1);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.api = originalApi;
    window.__dmn_window_type = originalWindowType;
    window.__dmn_runtime = originalRuntime;
    vi.restoreAllMocks();
  });

  it('customTabs 변경이 모드를 바꾸면 선택을 리셋한다', () => {
    act(() => {
      mocks.customTabsListener?.(customTabsPayload('8key'));
    });

    expect(clearSelection).toHaveBeenCalledTimes(1);
    expect(mocks.keyState.selectedKeyType).toBe('8key');
  });

  it('customTabs만 바뀌고 모드가 같으면 선택을 건드리지 않는다', () => {
    act(() => {
      mocks.customTabsListener?.(
        customTabsPayload('4key', true, [{ id: 'tab-a' }]),
      );
    });

    expect(clearSelection).not.toHaveBeenCalled();
    expect(mocks.keyState.customTabs).toEqual([{ id: 'tab-a' }]);
  });

  it('선택 비권위 이벤트는 진행 중인 선택과 그리드 선택을 보존한다', () => {
    mocks.keyState = { ...mocks.keyState, selectedKeyType: '8key' };

    act(() => {
      mocks.customTabsListener?.(customTabsPayload('4key', false));
    });

    expect(clearSelection).not.toHaveBeenCalled();
    expect(mocks.keyState.selectedKeyType).toBe('8key');
  });

  it('프리셋 스냅샷이 모드를 바꾸면 선택을 리셋한다', () => {
    act(() => {
      mocks.presetSnapshotListener?.(snapshotPayload('8key'));
    });

    expect(clearSelection).toHaveBeenCalledTimes(1);
  });

  it('프리셋 스냅샷의 모드가 같으면 선택을 건드리지 않는다', () => {
    act(() => {
      mocks.presetSnapshotListener?.(snapshotPayload('4key'));
    });

    expect(clearSelection).not.toHaveBeenCalled();
  });

  it('OBS 재동기화 탭 스냅샷도 store 채택 관문을 지난다', async () => {
    const bootstrap = {
      ...makeBootstrap(),
      customTabs: [{ id: 'tab-a', name: 'A' }],
      tabOrder: ['tab-a', '4key', '5key', '6key', '8key'],
      barCount: 3,
      selectedKeyType: 'tab-a',
    } as unknown as BootstrapPayload;
    mocks.bootstrap.mockResolvedValueOnce(bootstrap);
    mocks.keyState = {
      ...mocks.keyState,
      customTabs: bootstrap.customTabs,
      tabOrder: bootstrap.tabOrder,
      barCount: bootstrap.barCount,
      selectedKeyType: bootstrap.selectedKeyType,
      deferredTabPlacement: {
        tabOrder: ['8key', '6key', '5key', '4key'],
        barCount: 2,
      },
    };
    mocks.adoptTabMetadataEvent.mockClear();

    await act(async () => {
      mocks.resyncListener?.();
      await Promise.resolve();
    });

    expect(mocks.adoptTabMetadataEvent).toHaveBeenCalledWith({
      customTabs: bootstrap.customTabs,
      tabOrder: bootstrap.tabOrder,
      barCount: bootstrap.barCount,
      selectedKeyType: bootstrap.selectedKeyType,
      selectionAuthoritative: true,
    });
  });

  it('OBS 런타임에서는 편집 히스토리 상태를 조회하지 않는다', async () => {
    act(() => root.unmount());
    container.remove();
    window.__dmn_runtime = 'obs';
    mocks.syncHistoryStatus.mockClear();
    mocks.keyState = {
      selectedKeyType: '4key',
      isBootstrapped: false,
      customTabs: [],
    };

    await mount();

    expect(mocks.syncHistoryStatus).not.toHaveBeenCalled();
  });

  it('오버레이 창에서는 리셋하지 않는다', async () => {
    act(() => root.unmount());
    container.remove();
    window.__dmn_window_type = 'overlay';
    mocks.keyState = {
      selectedKeyType: '4key',
      isBootstrapped: false,
      customTabs: [],
    };
    await mount();

    act(() => {
      mocks.customTabsListener?.(customTabsPayload('8key'));
    });

    expect(clearSelection).not.toHaveBeenCalled();
  });

  it('영구 저장 실패를 짧은 두 줄 문구로 한 번 알린다', async () => {
    useSettingsStore.setState({ language: 'ko' });
    const error = new Error('invalid editor document');
    const permanentState = {
      ...mocks.editorState,
      phase: 'error',
      failureKind: 'permanent',
      error,
    } as EditorCoordinatorState;

    act(() => {
      mocks.editorStateListener?.(permanentState);
      mocks.editorStateListener?.(permanentState);
    });

    expect(mocks.dialogAlert).toHaveBeenCalledOnce();
    expect(mocks.dialogAlert).toHaveBeenCalledWith(
      '저장하지 못해 변경 내용을 되돌렸습니다.\n방금 바꾼 값을 확인해 주세요.',
      { confirmText: '확인' },
    );
  });

  it('저장 한도 실패는 원인에 맞는 짧은 문구로 알린다', async () => {
    useSettingsStore.setState({ language: 'ko' });
    const permanentState = {
      ...mocks.editorState,
      phase: 'error',
      failureKind: 'permanent',
      error: {
        errorCode: 'VALIDATION_FAILED',
        message: 'collection too large',
        details: { validationCode: 'COLLECTION_TOO_LARGE' },
        retryable: false,
      },
    } as EditorCoordinatorState;

    act(() => {
      mocks.editorStateListener?.(permanentState);
    });

    expect(mocks.dialogAlert).toHaveBeenCalledWith(
      '저장 한도를 넘어 변경을 되돌렸습니다.\n일부 요소를 줄이고 다시 시도해 주세요.',
      { confirmText: '확인' },
    );
  });

  it('알 수 없는 검증 코드는 일반 저장 실패 문구로 알린다', async () => {
    useSettingsStore.setState({ language: 'ko' });
    const permanentState = {
      ...mocks.editorState,
      phase: 'error',
      failureKind: 'permanent',
      error: {
        errorCode: 'VALIDATION_FAILED',
        message: 'unknown validation',
        details: { validationCode: 'NEW_VALIDATION_CODE' },
        retryable: false,
      },
    } as EditorCoordinatorState;

    act(() => {
      mocks.editorStateListener?.(permanentState);
    });

    expect(mocks.dialogAlert).toHaveBeenCalledWith(
      '저장하지 못해 변경 내용을 되돌렸습니다.\n방금 바꾼 값을 확인해 주세요.',
      { confirmText: '확인' },
    );
  });
});
