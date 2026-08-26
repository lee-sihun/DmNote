import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';
import { useKeyStore } from '@stores/data/useKeyStore';
import { getKeySignal, resetAllKeySignals } from '@stores/signals/keySignals';
import { useSettingsStore } from '@stores/useSettingsStore';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  keyEventListener: null as null | ((payload: unknown) => void),
  keysResetListener: null as null | ((payload: unknown) => void),
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
// 이 파일은 키 딜레이 타이머 개수를 정확히 세므로 리빌 게이트의 데드라인 타이머를 배제
vi.mock('@hooks/overlay/useOverlayReveal', () => ({
  useOverlayReveal: () => true,
}));
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
    reconcileActiveNotes: vi.fn(),
    noteBuffer: {},
    updateTrackLayouts: vi.fn(),
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
// usePluginDisplayElementStore는 실제 스토어 사용 — App이 store API
// (getState/subscribe)를 요구하며, 이 파일은 플러그인 요소를 조작하지 않음
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
      return vi.fn();
    }),
    initialize: vi.fn(() => Promise.resolve()),
  },
}));
vi.mock('@api/modules/obsApi', () => ({
  obsApi: {
    onResync: vi.fn(() => vi.fn()),
  },
}));

import App from './App';

const makeApiMock = () =>
  ({
    app: { bootstrap: mocks.bootstrap },
    keys: {
      onKeysReset: vi.fn((listener: (payload: unknown) => void) => {
        mocks.keysResetListener = listener;
        return vi.fn();
      }),
    },
  } as unknown as Window['api']);

describe('키 표시 지연 타이머', () => {
  let container: HTMLDivElement;
  let root: Root;
  let mounted: boolean;
  let originalApi: Window['api'];

  const flushAsync = async () => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  const emitKeyState = (state: 'DOWN' | 'UP') => {
    act(() => {
      mocks.keyEventListener?.({
        key: 'KeyK',
        state,
        mode: '4key',
        eventAgeMs: 0,
      });
    });
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    originalApi = window.api;
    window.api = makeApiMock();
    mocks.bootstrap.mockReset();
    mocks.bootstrap.mockResolvedValue({ activeKeys: [] });
    mocks.keyEventListener = null;
    mocks.keysResetListener = null;
    resetAllKeySignals();

    useKeyStore.setState({
      selectedKeyType: '4key',
      customTabs: [],
      keyMappings: { '4key': ['KeyK'] },
      positions: {
        '4key': [createDefaultKeyPosition(0, 0)],
      },
      canonicalPositions: { '4key': [] },
      isBootstrapped: true,
      isLocalUpdateInProgress: false,
    });
    useSettingsStore.setState((state) => ({
      noteEffect: false,
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
      root.render(<App />);
    });
    await flushAsync();
  });

  afterEach(() => {
    if (mounted) {
      act(() => root.unmount());
    }
    container.remove();
    resetAllKeySignals();
    window.api = originalApi;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('지연 설정 변경 시 대기 중인 DOWN/UP을 예약 순서대로 반영한다', async () => {
    const transitions: boolean[] = [];
    const unsubscribe = getKeySignal('KeyK').subscribe((value) => {
      transitions.push(value);
    });
    transitions.length = 0;

    emitKeyState('DOWN');
    emitKeyState('UP');
    expect(vi.getTimerCount()).toBe(2);

    await act(async () => {
      useSettingsStore.setState((state) => ({
        noteSettings: {
          ...state.noteSettings,
          keyDisplayDelayMs: 10000,
        },
      }));
    });

    expect(vi.getTimerCount()).toBe(0);
    expect(transitions).toEqual([true, false]);
    expect(getKeySignal('KeyK').value).toBe(false);

    const transitionCount = transitions.length;
    vi.advanceTimersByTime(30000);
    expect(transitions).toHaveLength(transitionCount);
    expect(getKeySignal('KeyK').value).toBe(false);

    emitKeyState('DOWN');
    vi.advanceTimersByTime(9999);
    expect(getKeySignal('KeyK').value).toBe(false);
    vi.advanceTimersByTime(1);
    expect(getKeySignal('KeyK').value).toBe(true);
    unsubscribe();
  });

  it('keys reset 시 모든 키 타이머를 취소한다', () => {
    const transitions: boolean[] = [];
    const unsubscribe = getKeySignal('KeyK').subscribe((value) => {
      transitions.push(value);
    });
    transitions.length = 0;

    emitKeyState('DOWN');
    expect(vi.getTimerCount()).toBe(1);

    act(() => {
      mocks.keysResetListener?.({ reason: 'hook_restart' });
    });

    expect(vi.getTimerCount()).toBe(0);
    expect(transitions).not.toContain(true);
    vi.advanceTimersByTime(30000);
    expect(getKeySignal('KeyK').value).toBe(false);
    unsubscribe();
  });

  it('unmount 시 모든 키 타이머를 취소한다', () => {
    const transitions: boolean[] = [];
    const unsubscribe = getKeySignal('KeyK').subscribe((value) => {
      transitions.push(value);
    });
    transitions.length = 0;

    emitKeyState('DOWN');
    expect(vi.getTimerCount()).toBe(1);

    act(() => root.unmount());
    mounted = false;

    expect(vi.getTimerCount()).toBe(0);
    expect(transitions).not.toContain(true);
    vi.advanceTimersByTime(30000);
    expect(getKeySignal('KeyK').value).toBe(false);
    unsubscribe();
  });
});
