import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';
import { useKeyStore } from '@stores/data/useKeyStore';
import { resetAllKeySignals } from '@stores/signals/keySignals';
import type { KeyPosition } from '@src/types/key/keys';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  resize: vi.fn(),
  scene: vi.fn(),
  updateTrackLayouts: vi.fn(),
  clearAllNotes: vi.fn(),
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
    reconcileActiveNotes: vi.fn(),
    clearAllNotes: mocks.clearAllNotes,
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
    overlayResizeAnchor: 'top-left',
    keyCounterEnabled: false,
  };
  return {
    useSettingsStore: <T,>(selector: (value: typeof state) => T) =>
      selector(state),
  };
});
vi.mock('@stores/plugin/usePluginDisplayElementStore', () => {
  const state = { elements: [] };
  return {
    usePluginDisplayElementStore: <T,>(
      selector: (state: { elements: never[] }) => T,
    ) => selector(state as { elements: never[] }),
  };
});
// 실제 computeLayout을 사용하므로 FALLBACK_POSITION도 함께 노출
vi.mock('@components/shared/OverlayScene', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.scene(props);
    return null;
  },
  FALLBACK_POSITION: {
    dx: 0,
    dy: 0,
    width: 60,
    height: 60,
    hidden: false,
    noteAutoYCorrection: true,
  },
}));
vi.mock('@utils/core/axisEventBus', () => ({
  axisEventBus: { initialize: vi.fn() },
}));
vi.mock('@utils/core/keyEventBus', () => ({
  keyEventBus: {
    subscribe: vi.fn(() => vi.fn()),
    initialize: vi.fn(() => Promise.resolve()),
  },
}));
vi.mock('@api/modules/obsApi', () => ({
  obsApi: { onResync: vi.fn(() => vi.fn()) },
}));

import App from './App';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
};

const flushAsync = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

const makeApiMock = () =>
  ({
    app: { bootstrap: mocks.bootstrap },
    keys: { onKeysReset: vi.fn(() => vi.fn()) },
    overlay: { resize: mocks.resize },
  } as unknown as Window['api']);

const pos = (dx: number, dy: number, overrides: Partial<KeyPosition> = {}) => ({
  ...createDefaultKeyPosition(dx, dy),
  ...overrides,
});

const lastSceneProps = () =>
  mocks.scene.mock.calls.at(-1)?.[0] as
    | {
        selectedKeyType: string;
        displayPositions: KeyPosition[];
        currentKeys: string[];
      }
    | undefined;

const lastResizePayload = () =>
  mocks.resize.mock.calls.at(-1)?.[0] as {
    width: number;
    height: number;
    anchor: string;
    contentMargins: {
      top: number;
      bottom: number;
      left: number;
      right: number;
    };
  };

// 부팅 시퀀스 재현: 빈 store로 마운트한 뒤 bootstrap이 채우는 순서
const bootLikeState = (
  selectedKeyType: string,
  positionsByMode: Record<string, KeyPosition[]>,
) => {
  const keyMappings = Object.fromEntries(
    Object.entries(positionsByMode).map(([mode, positions]) => [
      mode,
      positions.map((_, index) => `Key${mode}-${index}`),
    ]),
  );
  return {
    selectedKeyType,
    keyMappings,
    positions: positionsByMode,
    canonicalPositions: positionsByMode,
    isBootstrapped: true,
  };
};

describe('overlay geometry transaction', () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalApi: Window['api'];

  beforeEach(async () => {
    originalApi = window.api;
    mocks.bootstrap.mockReset();
    mocks.bootstrap.mockResolvedValue({ activeKeys: [] });
    mocks.resize.mockReset();
    mocks.resize.mockImplementation(
      (payload: { width: number; height: number }) =>
        Promise.resolve({
          x: 0,
          y: 0,
          width: payload.width,
          height: payload.height,
        }),
    );
    mocks.scene.mockClear();
    mocks.updateTrackLayouts.mockClear();
    mocks.clearAllNotes.mockClear();
    window.api = makeApiMock();
    useKeyStore.setState({
      selectedKeyType: '4key',
      customTabs: [],
      keyMappings: {},
      positions: {},
      canonicalPositions: {},
      isBootstrapped: false,
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
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    resetAllKeySignals();
    window.api = originalApi;
    vi.restoreAllMocks();
  });

  it('부팅: 빈 candidate는 즉시 승격되고 실제 candidate는 resize 성공 시 커밋된다', async () => {
    // 부트스트랩 전: 빈 스냅샷이 이미 승격되어 있고 resize는 불필요
    expect(mocks.resize).not.toHaveBeenCalled();
    expect(lastSceneProps()?.displayPositions).toHaveLength(0);

    const pending = deferred<{
      x: number;
      y: number;
      width: number;
      height: number;
    }>();
    mocks.resize.mockReturnValueOnce(pending.promise);

    await act(async () => {
      useKeyStore.setState(
        bootLikeState('8key', { '8key': [pos(0, 0), pos(100, 0)] }),
      );
    });
    await flushAsync();

    // in-flight 동안은 이전(빈) 스냅샷 유지
    expect(mocks.resize).toHaveBeenCalledTimes(1);
    expect(lastResizePayload()).toMatchObject({
      width: 220,
      height: 420,
      anchor: 'top-left',
      contentMargins: { top: 330, bottom: 30, left: 30, right: 30 },
    });
    expect(lastSceneProps()?.selectedKeyType).toBe('4key');
    expect(lastSceneProps()?.displayPositions).toHaveLength(0);

    await act(async () => {
      pending.resolve({ x: 0, y: 0, width: 220, height: 420 });
    });
    await flushAsync();

    expect(lastSceneProps()?.selectedKeyType).toBe('8key');
    expect(lastSceneProps()?.displayPositions).toHaveLength(2);
  });

  it('부팅: resize 전송 실패에도 부팅 탭 렌더는 승격된다', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.resize.mockImplementationOnce(() =>
      Promise.reject(new Error('ipc down')),
    );

    await act(async () => {
      useKeyStore.setState(bootLikeState('8key', { '8key': [pos(0, 0)] }));
    });
    await flushAsync();

    expect(mocks.resize).toHaveBeenCalledTimes(1);
    expect(lastSceneProps()?.selectedKeyType).toBe('8key');
    expect(lastSceneProps()?.displayPositions).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('상한 초과 candidate는 4096으로 포화해 요청하고 전체 레이아웃 기준으로 렌더한다', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // 실측 회귀 데이터: dx 9999 / width 999 키가 있으면 요구 폭이 상한 초과
    await act(async () => {
      useKeyStore.setState(
        bootLikeState('8key', {
          '8key': [pos(0, 0), pos(9999, 0, { width: 999 })],
        }),
      );
    });
    await flushAsync();

    expect(mocks.resize).toHaveBeenCalledTimes(1);
    expect(lastResizePayload().width).toBe(4096);
    expect(lastResizePayload().height).toBe(420);
    // 마진은 클램프하지 않고 원본 유지 (백엔드 delta 북키핑 보존)
    expect(lastResizePayload().contentMargins).toEqual({
      top: 330,
      bottom: 30,
      left: 30,
      right: 30,
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('saturating window size'),
    );

    // 렌더는 클램프가 아니라 전체 레이아웃 기준 (두 키 모두, 오프셋 반영)
    const scene = lastSceneProps();
    expect(scene?.selectedKeyType).toBe('8key');
    expect(scene?.displayPositions).toHaveLength(2);
    expect(scene?.displayPositions[1].dx).toBe(10029);
  });

  it('resize 거부 후 동일 params candidate가 no-op으로 눌리지 않고 재시도한다', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.resize.mockImplementationOnce(() =>
      Promise.reject({
        errorCode: 'OVERLAY_DIMENSION_EXCEEDED',
        details: {
          desiredWidth: 120,
          desiredHeight: 420,
          maxWidth: 4096,
          maxHeight: 4096,
        },
        retryable: false,
      }),
    );

    await act(async () => {
      useKeyStore.setState(bootLikeState('8key', { '8key': [pos(0, 0)] }));
    });
    await flushAsync();

    // 거부돼도 렌더는 승격, native 기록은 미갱신
    expect(mocks.resize).toHaveBeenCalledTimes(1);
    expect(lastSceneProps()?.selectedKeyType).toBe('8key');
    expect(warnSpy).toHaveBeenCalled();

    // 같은 params의 새 candidate: no-op이 아니라 재디스패치되어야 함
    await act(async () => {
      useKeyStore.setState((state) => ({
        positions: { ...state.positions, '8key': [pos(0, 0)] },
      }));
    });
    await flushAsync();
    expect(mocks.resize).toHaveBeenCalledTimes(2);

    // 성공 후 같은 params의 세 번째 candidate는 no-op 승격 (IPC 생략)
    await act(async () => {
      useKeyStore.setState((state) => ({
        positions: { ...state.positions, '8key': [pos(0, 0)] },
      }));
    });
    await flushAsync();
    expect(mocks.resize).toHaveBeenCalledTimes(2);
    expect(lastSceneProps()?.displayPositions).toHaveLength(1);
  });

  it('탭 왕복: 초과 탭과 정상 탭을 오가도 항상 해당 탭이 렌더된다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const positionsByMode = {
      '4key': [pos(0, 0)],
      '8key': [pos(0, 0), pos(9999, 0, { width: 999 })],
    };

    await act(async () => {
      useKeyStore.setState(bootLikeState('8key', positionsByMode));
    });
    await flushAsync();
    expect(lastSceneProps()?.selectedKeyType).toBe('8key');
    expect(lastResizePayload().width).toBe(4096);

    await act(async () => {
      useKeyStore.setState({ selectedKeyType: '4key' });
    });
    await flushAsync();
    expect(lastSceneProps()?.selectedKeyType).toBe('4key');
    expect(lastResizePayload().width).toBe(120);

    await act(async () => {
      useKeyStore.setState({ selectedKeyType: '8key' });
    });
    await flushAsync();
    expect(lastSceneProps()?.selectedKeyType).toBe('8key');
    expect(lastSceneProps()?.displayPositions).toHaveLength(2);
    expect(lastResizePayload().width).toBe(4096);
  });

  it('in-flight 중 도착한 최신 candidate는 settle 후 재디스패치된다', async () => {
    const first = deferred<{
      x: number;
      y: number;
      width: number;
      height: number;
    }>();
    const second = deferred<{
      x: number;
      y: number;
      width: number;
      height: number;
    }>();
    mocks.resize
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    await act(async () => {
      useKeyStore.setState(bootLikeState('8key', { '8key': [pos(0, 0)] }));
    });
    await flushAsync();
    expect(mocks.resize).toHaveBeenCalledTimes(1);

    // in-flight 중 갱신: 즉시 디스패치하지 않고 최신 대기 슬롯에 저장
    await act(async () => {
      useKeyStore.setState((state) => ({
        positions: { ...state.positions, '8key': [pos(0, 0), pos(100, 0)] },
      }));
    });
    await flushAsync();
    expect(mocks.resize).toHaveBeenCalledTimes(1);

    // 첫 성공 커밋 후 대기 candidate 재디스패치
    await act(async () => {
      first.resolve({ x: 0, y: 0, width: 120, height: 420 });
    });
    await flushAsync();
    expect(mocks.resize).toHaveBeenCalledTimes(2);
    expect(lastSceneProps()?.displayPositions).toHaveLength(1);

    await act(async () => {
      second.resolve({ x: 0, y: 0, width: 220, height: 420 });
    });
    await flushAsync();
    expect(lastSceneProps()?.displayPositions).toHaveLength(2);
  });

  it('비유한 지오메트리는 native 호출 없이 렌더만 승격한다', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await act(async () => {
      useKeyStore.setState(
        bootLikeState('8key', { '8key': [pos(Number.NaN, 0)] }),
      );
    });
    await flushAsync();

    expect(mocks.resize).not.toHaveBeenCalled();
    expect(lastSceneProps()?.selectedKeyType).toBe('8key');
    expect(lastSceneProps()?.displayPositions).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('non-finite geometry'),
      expect.anything(),
    );
  });
});
