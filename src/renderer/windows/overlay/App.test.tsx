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
  handleKeyDown: vi.fn(),
  handleKeyUp: vi.fn(),
  finalizeAllActive: vi.fn(),
  reconcileActiveNotes: vi.fn(),
  subscribe: vi.fn((_cb: (event: unknown) => void) => () => {}),
  notesRef: { current: {} },
  noteBuffer: {},
  resyncListener: null as null | (() => void),
  keysResetListener: null as null | ((payload: unknown) => void),
  sceneRenders: { count: 0 },
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
  // 실제 훅이 불안정 참조를 반환해도 App이 재구독·리셋하지 않아야 한다는
  // 계약(#111)을 검증하기 위해 의도적으로 매 렌더 새 identity를 반환.
  // 안정 참조(mocks.handleKeyDown 직접 전달)로 되돌리지 말 것
  useNoteSystem: () => ({
    notesRef: mocks.notesRef,
    subscribe: (cb: (event: unknown) => void) => mocks.subscribe(cb),
    handleKeyDown: (...args: unknown[]) => mocks.handleKeyDown(...args),
    handleKeyUp: (...args: unknown[]) => mocks.handleKeyUp(...args),
    finalizeAllActive: (...args: unknown[]) => mocks.finalizeAllActive(...args),
    reconcileActiveNotes: (...args: unknown[]) =>
      mocks.reconcileActiveNotes(...args),
    noteBuffer: mocks.noteBuffer,
    updateTrackLayouts: (...args: unknown[]) =>
      mocks.updateTrackLayouts(...args),
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
// 실제 zustand 스토어로 모킹 - setState로 설정 변경 시 App이 반응형으로
// 리렌더되어야 "레이아웃 무관 설정 변경" 시나리오를 검증할 수 있음
vi.mock('@stores/useSettingsStore', async () => {
  const { create } = await import('zustand');
  const useSettingsStore = create(() => ({
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
  }));
  return { useSettingsStore };
});
// usePluginDisplayElementStore는 실제 스토어 사용 — 플러그인 element 갱신이
// 오버레이 App에 미치는 영향(리렌더 승격·signal 리셋)을 실제 경로로 검증
vi.mock('@components/shared/OverlayScene', () => ({
  default: () => {
    mocks.sceneRenders.count += 1;
    return null;
  },
}));
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
vi.mock('@api/modules/obsApi', () => ({
  obsApi: {
    onResync: vi.fn((listener: () => void) => {
      mocks.resyncListener = listener;
      return vi.fn();
    }),
  },
}));

import App from './App';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { useSettingsStore } from '@stores/useSettingsStore';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

// 스토어 updateElementBatched의 모듈 전역 rAF 큐(pendingStateUpdates·rafScheduled)를
// 결정적으로 제어 - 테스트 종료 시 예약 callback을 전부 소진해 다음 테스트로의 누수 차단
type RafCallback = (time: number) => void;
const rafCallbacks = new Map<number, RafCallback>();
let rafIdCounter = 0;

const flushRafCallbacks = () => {
  // 콜백이 rAF를 재예약하며 수렴하지 않으면 행 대신 즉시 실패
  let rounds = 0;
  while (rafCallbacks.size > 0) {
    if (++rounds > 20) {
      throw new Error('rAF 콜백이 20라운드 내에 수렴하지 않음 (재예약 루프?)');
    }
    const pending = [...rafCallbacks.values()];
    rafCallbacks.clear();
    pending.forEach((callback) => callback(performance.now()));
  }
};

beforeEach(() => {
  rafCallbacks.clear();
  vi.stubGlobal('requestAnimationFrame', (callback: RafCallback) => {
    rafIdCounter += 1;
    rafCallbacks.set(rafIdCounter, callback);
    return rafIdCounter;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    rafCallbacks.delete(id);
  });
  usePluginDisplayElementStore.setState({ elements: [] });
  // 테스트가 변경할 수 있는 설정 필드 초기화 (모킹 스토어는 파일 수명 동안 유지됨)
  useSettingsStore.setState({
    noteEffect: false,
    tabNoteOverrides: {},
    backgroundColor: 'transparent',
  });
});

afterEach(() => {
  act(() => {
    flushRafCallbacks();
  });
  usePluginDisplayElementStore.setState({ elements: [] });
  vi.unstubAllGlobals();
});

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

const resetSharedMocks = () => {
  mocks.bootstrap.mockReset();
  mocks.bootstrap.mockResolvedValue({ activeKeys: [] });
  mocks.keyEventListener = null;
  mocks.resyncListener = null;
  mocks.keysResetListener = null;
  mocks.unsubscribeKeyEvents.mockClear();
  mocks.updateTrackLayouts.mockClear();
  mocks.handleKeyDown.mockClear();
  mocks.handleKeyUp.mockClear();
  mocks.finalizeAllActive.mockClear();
  mocks.reconcileActiveNotes.mockClear();
  mocks.subscribe.mockClear();
  mocks.sceneRenders.count = 0;
};

describe('overlay active key reconciliation', () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalApi: Window['api'];

  beforeEach(async () => {
    originalApi = window.api;
    resetSharedMocks();
    useSettingsStore.setState({ noteEffect: false });
    window.api = makeApiMock();
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

describe('note timing payload and loss recovery', () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalApi: Window['api'];

  beforeEach(async () => {
    originalApi = window.api;
    resetSharedMocks();
    useSettingsStore.setState({ noteEffect: true });
    window.api = makeApiMock();
    useKeyStore.setState({
      selectedKeyType: '4key',
      customTabs: [],
      keyMappings: {
        '4key': ['KeyK', 'KeyJ'],
        '8key': ['KeyQ'],
      },
      positions: {
        '4key': [
          { ...createDefaultKeyPosition(0, 0), noteEffectEnabled: false },
          createDefaultKeyPosition(70, 0),
        ],
        '8key': [],
      },
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

  it('noteEffectEnabled가 꺼진 키도 UP은 항상 노트 시스템에 전달된다', async () => {
    await act(async () => {
      mocks.keyEventListener?.({
        key: 'KeyK',
        state: 'DOWN',
        mode: '4key',
        eventAgeMs: 0,
      });
    });
    expect(mocks.handleKeyDown).not.toHaveBeenCalled();

    await act(async () => {
      mocks.keyEventListener?.({
        key: 'KeyK',
        state: 'UP',
        mode: '4key',
        eventAgeMs: 0,
        holdDurationMs: 20,
      });
    });
    expect(mocks.handleKeyUp).toHaveBeenCalledWith(
      'KeyK',
      expect.objectContaining({ holdDurationMs: 20 }),
    );
  });

  it('표시 시각은 클램프하고 판정 시각은 비클램프로 분리 전달한다', async () => {
    await act(async () => {
      mocks.keyEventListener?.({
        key: 'KeyJ',
        state: 'UP',
        mode: '4key',
        eventAgeMs: 500,
        holdDurationMs: 42,
      });
    });

    expect(mocks.handleKeyUp).toHaveBeenCalledTimes(1);
    const [, timing] = mocks.handleKeyUp.mock.calls[0] as [
      string,
      { displayTime: number; physTime: number; holdDurationMs?: number },
    ];
    expect(timing.holdDurationMs).toBe(42);
    // displayTime은 250ms 클램프, physTime은 원 age(500ms) 그대로
    expect(timing.displayTime - timing.physTime).toBeCloseTo(250, 0);
  });

  it('keys:reset 수신 시 활성 노트를 강제 완료하고 눌림 상태를 재수화한다', async () => {
    mocks.bootstrap.mockResolvedValue({ activeKeys: ['KeyJ'] });

    await act(async () => {
      mocks.keysResetListener?.({ reason: 'hook_restart' });
    });
    await flushAsync();

    expect(mocks.finalizeAllActive).toHaveBeenCalled();
    expect(mocks.bootstrap).toHaveBeenCalled();
    expect(getKeySignal('KeyJ').value).toBe(true);
  });

  it('obs:resync 수신 시 모드 삼중 일치에서만 스냅샷 대조를 실행한다', async () => {
    mocks.bootstrap.mockResolvedValue({
      activeKeys: ['KeyJ'],
      selectedKeyType: '4key',
      currentMode: '4key',
    });

    await act(async () => {
      mocks.resyncListener?.();
    });
    await flushAsync();

    expect(mocks.reconcileActiveNotes).toHaveBeenCalledTimes(1);
    const [held] = mocks.reconcileActiveNotes.mock.calls[0] as [Set<string>];
    expect(held.has('KeyJ')).toBe(true);
    expect(held.has('KeyK')).toBe(false);
  });

  it('obs:resync 스냅샷의 모드가 어긋나면 대조를 건너뛴다', async () => {
    mocks.bootstrap.mockResolvedValue({
      activeKeys: ['KeyJ'],
      selectedKeyType: '4key',
      currentMode: '8key',
    });

    await act(async () => {
      mocks.resyncListener?.();
    });
    await flushAsync();

    expect(mocks.reconcileActiveNotes).not.toHaveBeenCalled();
  });

  it('중첩 대조에서 낡은 응답을 적용하지 않는다', async () => {
    type Snapshot = {
      activeKeys: string[];
      selectedKeyType: string;
      currentMode: string;
    };
    const first = deferred<Snapshot>();
    const second = deferred<Snapshot>();
    mocks.bootstrap
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    await act(async () => {
      mocks.resyncListener?.();
    });
    await act(async () => {
      mocks.resyncListener?.();
    });

    second.resolve({
      activeKeys: ['KeyJ'],
      selectedKeyType: '4key',
      currentMode: '4key',
    });
    await flushAsync();
    expect(mocks.reconcileActiveNotes).toHaveBeenCalledTimes(1);

    first.resolve({
      activeKeys: [],
      selectedKeyType: '4key',
      currentMode: '4key',
    });
    await flushAsync();
    // 첫 요청의 낡은 응답은 무시 - 최신 세대만 적용
    expect(mocks.reconcileActiveNotes).toHaveBeenCalledTimes(1);
    const [held] = mocks.reconcileActiveNotes.mock.calls[0] as [Set<string>];
    expect(held.has('KeyJ')).toBe(true);
  });

  it('keys:reset은 진행 중 대조를 무효화한다', async () => {
    const pending = deferred<{
      activeKeys: string[];
      selectedKeyType: string;
      currentMode: string;
    }>();
    mocks.bootstrap.mockReturnValueOnce(pending.promise);

    await act(async () => {
      mocks.resyncListener?.();
    });
    await act(async () => {
      mocks.keysResetListener?.({ reason: 'hook_restart' });
    });

    pending.resolve({
      activeKeys: ['KeyJ'],
      selectedKeyType: '4key',
      currentMode: '4key',
    });
    await flushAsync();

    // 리셋 이전 스냅샷은 적용되지 않아야 함
    expect(mocks.reconcileActiveNotes).not.toHaveBeenCalled();
  });
});

describe('plugin element 갱신 격리 (#111)', () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalApi: Window['api'];

  const makePluginElement = () => ({
    id: 'el',
    fullId: 'plugin:el',
    pluginId: 'plugin',
    html: '<div>tick: 0</div>',
    position: { x: 0, y: 0 },
    tabId: '4key',
    state: { count: 0 },
  });

  beforeEach(async () => {
    originalApi = window.api;
    resetSharedMocks();
    useSettingsStore.setState({ noteEffect: false });
    window.api = makeApiMock();
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
    await act(async () => {
      usePluginDisplayElementStore.getState().addElement(makePluginElement());
    });
    mocks.bootstrap.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    resetAllKeySignals();
    window.api = originalApi;
    vi.restoreAllMocks();
  });

  it('state/html만 갱신하면 오버레이 루트를 리렌더하지 않는다', async () => {
    const before = mocks.sceneRenders.count;

    await act(async () => {
      usePluginDisplayElementStore
        .getState()
        .updateElementBatched('plugin:el', { state: { count: 1 } });
      flushRafCallbacks();
    });
    await act(async () => {
      usePluginDisplayElementStore
        .getState()
        .updateElement('plugin:el', { html: '<div>tick: 1</div>' });
    });
    expect(mocks.sceneRenders.count).toBe(before);

    // positive control - 레이아웃 필드(position) 변경은 리렌더되어야 함
    await act(async () => {
      usePluginDisplayElementStore
        .getState()
        .updateElement('plugin:el', { position: { x: 30, y: 0 } });
    });
    expect(mocks.sceneRenders.count).toBeGreaterThan(before);
  });

  it('plugin element 갱신이 키 눌림 signal을 리셋하지 않는다', async () => {
    setKeyActive('KeyK', true);

    // state 갱신 (App 리렌더 없음)
    await act(async () => {
      usePluginDisplayElementStore
        .getState()
        .updateElementBatched('plugin:el', { state: { count: 2 } });
      flushRafCallbacks();
    });
    expect(getKeySignal('KeyK').value).toBe(true);

    // 레이아웃 필드 갱신으로 App이 실제 리렌더된 뒤에도 유지 -
    // useNoteSystem 모킹이 불안정 identity를 반환해도 재구독·리셋되지 않아야 함
    await act(async () => {
      usePluginDisplayElementStore.getState().updateElement('plugin:el', {
        measuredSize: { width: 80, height: 40 },
      });
    });
    await flushAsync();
    expect(getKeySignal('KeyK').value).toBe(true);
    expect(mocks.bootstrap).not.toHaveBeenCalled();
  });
});

describe('computeLayout 메모이제이션', () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalApi: Window['api'];

  beforeEach(async () => {
    originalApi = window.api;
    resetSharedMocks();
    window.api = makeApiMock();
    useKeyStore.setState({
      selectedKeyType: '4key',
      customTabs: [],
      keyMappings: {
        '4key': ['KeyK', 'KeyJ'],
        '8key': ['KeyQ'],
      },
      positions: { '4key': [createDefaultKeyPosition(0, 0)], '8key': [] },
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
    mocks.updateTrackLayouts.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    resetAllKeySignals();
    window.api = originalApi;
    vi.restoreAllMocks();
  });

  it('레이아웃 무관 설정 변경으로 리렌더되어도 updateTrackLayouts를 재호출하지 않는다', async () => {
    const renders = mocks.sceneRenders.count;

    await act(async () => {
      useSettingsStore.setState({ backgroundColor: '#123456' });
    });
    // App은 리렌더되었지만 레이아웃 입력은 그대로
    expect(mocks.sceneRenders.count).toBeGreaterThan(renders);
    expect(mocks.updateTrackLayouts).not.toHaveBeenCalled();

    // positive control - 레이아웃 입력(positions) 변경은 재호출되어야 함
    await act(async () => {
      useKeyStore.setState({
        positions: { '4key': [createDefaultKeyPosition(10, 20)], '8key': [] },
      });
    });
    expect(mocks.updateTrackLayouts).toHaveBeenCalled();
  });

  it('다른 탭의 노트 override 갱신은 updateTrackLayouts를 재호출하지 않는다', async () => {
    await act(async () => {
      useSettingsStore.setState({
        tabNoteOverrides: { '8key': { speed: 999 } },
      });
    });
    expect(mocks.updateTrackLayouts).not.toHaveBeenCalled();

    // positive control - 현재 탭 override는 noteSettings 재병합 → 재호출
    await act(async () => {
      useSettingsStore.setState({
        tabNoteOverrides: { '4key': { speed: 999 } },
      });
    });
    expect(mocks.updateTrackLayouts).toHaveBeenCalled();
  });

  it('window resize 이벤트는 App을 리렌더하지 않는다', async () => {
    // _layoutVersion 제거 결정의 문서 역할 - computeLayout은 창 크기를 읽지 않고
    // WebGL crop 재계산은 WebGLTracksOGL의 자체 resize 리스너가 담당
    const renders = mocks.sceneRenders.count;

    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(mocks.sceneRenders.count).toBe(renders);
    expect(mocks.updateTrackLayouts).not.toHaveBeenCalled();
  });
});
