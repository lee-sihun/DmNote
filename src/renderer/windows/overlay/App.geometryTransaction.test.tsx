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
  overlayAnchor: { value: 'top-left' },
  resizedListener: {
    current: null as
      | null
      | ((payload: {
          x: number;
          y: number;
          width: number;
          height: number;
          requestGen?: number;
        }) => void),
  },
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
    get overlayResizeAnchor() {
      return mocks.overlayAnchor.value;
    },
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
    overlay: {
      resize: mocks.resize,
      onResized: vi.fn(
        (listener: (typeof mocks.resizedListener)['current']) => {
          mocks.resizedListener.current = listener;
          return vi.fn();
        },
      ),
    },
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
    contentMin?: { x: number; y: number };
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
    mocks.overlayAnchor.value = 'top-left';
    mocks.resizedListener.current = null;
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

  it('부팅: 렌더는 즉시 승격되고 resize는 비동기로 발행된다', async () => {
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

    // 렌더는 resize 완료를 기다리지 않음 - 즉시 새 탭 표시 (master 의미론)
    expect(mocks.resize).toHaveBeenCalledTimes(1);
    expect(lastResizePayload()).toMatchObject({
      width: 220,
      height: 420,
      anchor: 'top-left',
      contentMargins: { top: 330, bottom: 30, left: 30, right: 30 },
    });
    expect(lastSceneProps()?.selectedKeyType).toBe('8key');
    expect(lastSceneProps()?.displayPositions).toHaveLength(2);

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

  it('실패는 last-sent를 무효화해 동일 params candidate도 재발행된다 (멱등)', async () => {
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

    // 거부돼도 렌더는 승격 (실패는 로그 전용)
    expect(mocks.resize).toHaveBeenCalledTimes(1);
    expect(lastSceneProps()?.selectedKeyType).toBe('8key');
    expect(warnSpy).toHaveBeenCalled();

    // 같은 params의 새 candidate: 실패로 last-sent가 무효화됐으므로 재발행
    await act(async () => {
      useKeyStore.setState((state) => ({
        positions: { ...state.positions, '8key': [pos(0, 0)] },
      }));
    });
    await flushAsync();
    expect(mocks.resize).toHaveBeenCalledTimes(2);

    // 성공 후 같은 params는 다시 no-op
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

    // in-flight 중 갱신: 렌더는 즉시 최신, 발행은 최신 대기 슬롯에 저장
    await act(async () => {
      useKeyStore.setState((state) => ({
        positions: { ...state.positions, '8key': [pos(0, 0), pos(100, 0)] },
      }));
    });
    await flushAsync();
    expect(mocks.resize).toHaveBeenCalledTimes(1);
    expect(lastSceneProps()?.displayPositions).toHaveLength(2);

    // 첫 응답 settle 후 대기 params 재발행
    await act(async () => {
      first.resolve({ x: 0, y: 0, width: 120, height: 420 });
    });
    await flushAsync();
    expect(mocks.resize).toHaveBeenCalledTimes(2);
    expect(lastResizePayload().width).toBe(220);

    await act(async () => {
      second.resolve({ x: 0, y: 0, width: 220, height: 420 });
    });
    await flushAsync();
    expect(lastSceneProps()?.displayPositions).toHaveLength(2);
  });

  it('all-up 탭 전환과 키 추가에는 clearAllNotes를 호출하지 않는다', async () => {
    await act(async () => {
      useKeyStore.setState(
        bootLikeState('8key', {
          '4key': [pos(0, 0)],
          '8key': [pos(0, 0), pos(100, 0)],
        }),
      );
    });
    await flushAsync();

    // 탭 전환 (모두 up)
    await act(async () => {
      useKeyStore.setState({ selectedKeyType: '4key' });
    });
    await flushAsync();
    expect(lastSceneProps()?.selectedKeyType).toBe('4key');

    // 같은 탭에서 키 추가 (모두 up)
    await act(async () => {
      useKeyStore.setState((state) => ({
        keyMappings: {
          ...state.keyMappings,
          '4key': ['Key4key-0', 'Key4key-1'],
        },
        positions: { ...state.positions, '4key': [pos(0, 0), pos(200, 0)] },
      }));
    });
    await flushAsync();
    expect(lastSceneProps()?.displayPositions).toHaveLength(2);

    expect(mocks.clearAllNotes).not.toHaveBeenCalled();
  });

  it('양쪽에 존재하는 트랙의 방향이 바뀐 경우에만 clearAllNotes를 호출한다', async () => {
    await act(async () => {
      useKeyStore.setState(bootLikeState('8key', { '8key': [pos(0, 0)] }));
    });
    await flushAsync();
    expect(mocks.clearAllNotes).not.toHaveBeenCalled();

    // 같은 트랙의 방향 변경: up → down
    await act(async () => {
      useKeyStore.setState((state) => ({
        positions: {
          ...state.positions,
          '8key': [pos(0, 0, { noteDirection: 'down' })],
        },
      }));
    });
    await flushAsync();
    expect(mocks.clearAllNotes).toHaveBeenCalledTimes(1);
  });

  it('영구 pending resize는 타임아웃 후 낙관 승격되고 큐가 복구된다', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.useFakeTimers();
    try {
      const never = deferred<{
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
        .mockReturnValueOnce(never.promise)
        .mockReturnValueOnce(second.promise);

      // A: 응답이 오지 않는 in-flight
      await act(async () => {
        useKeyStore.setState(bootLikeState('8key', { '8key': [pos(0, 0)] }));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(mocks.resize).toHaveBeenCalledTimes(1);

      // B: in-flight 중 도착한 최신 candidate는 큐에만 저장
      await act(async () => {
        useKeyStore.setState((state) => ({
          positions: { ...state.positions, '8key': [pos(0, 0), pos(100, 0)] },
        }));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(mocks.resize).toHaveBeenCalledTimes(1);

      // 타임아웃: in-flight 해제 + 대기 B 재발행 (큐 봉쇄 해제)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('timed out'),
      );
      expect(mocks.resize).toHaveBeenCalledTimes(2);
      expect(lastSceneProps()?.displayPositions).toHaveLength(2);

      await act(async () => {
        second.resolve({ x: 0, y: 0, width: 220, height: 420 });
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(lastSceneProps()?.displayPositions).toHaveLength(2);

      // 늦게 도착한 A 응답은 gen 단조 채택에서 뒤처져 상태를 덮지 않음
      await act(async () => {
        never.resolve({ x: 0, y: 0, width: 120, height: 420 });
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(lastSceneProps()?.displayPositions).toHaveLength(2);

      // 동일 params candidate는 last-sent(B) 기준 no-op
      await act(async () => {
        useKeyStore.setState((state) => ({
          positions: { ...state.positions, '8key': [pos(0, 0), pos(100, 0)] },
        }));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(mocks.resize).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('타임아웃은 native 지식을 무효화해 P 복귀 candidate가 no-op이 아니라 IPC로 재요청된다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.useFakeTimers();
    try {
      // P 성공으로 native 기준 확립 (width 120)
      await act(async () => {
        useKeyStore.setState(bootLikeState('8key', { '8key': [pos(0, 0)] }));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(mocks.resize).toHaveBeenCalledTimes(1);
      expect(lastResizePayload().width).toBe(120);

      // A: 영구 pending in-flight (width 220)
      const never = deferred<{
        x: number;
        y: number;
        width: number;
        height: number;
      }>();
      mocks.resize.mockReturnValueOnce(never.promise);
      await act(async () => {
        useKeyStore.setState((state) => ({
          positions: { ...state.positions, '8key': [pos(0, 0), pos(100, 0)] },
        }));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(mocks.resize).toHaveBeenCalledTimes(2);

      // candidate가 P로 복귀 - in-flight 중이라 큐잉만
      await act(async () => {
        useKeyStore.setState((state) => ({
          positions: { ...state.positions, '8key': [pos(0, 0)] },
        }));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(mocks.resize).toHaveBeenCalledTimes(2);

      // 타임아웃: 백엔드가 A를 적용했을 수 있으므로 queued P는
      // nativeParams(P)와의 no-op이 아니라 반드시 IPC 재요청이어야 함
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(mocks.resize).toHaveBeenCalledTimes(3);
      expect(lastResizePayload().width).toBe(120);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(lastSceneProps()?.displayPositions).toHaveLength(1);

      // 늦은 A 성공은 토큰 가드로 무시 - 렌더·native 기록을 덮지 않음
      await act(async () => {
        never.resolve({ x: 0, y: 0, width: 220, height: 420 });
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(lastSceneProps()?.displayPositions).toHaveLength(1);
      expect(mocks.resize).toHaveBeenCalledTimes(3);

      // 재요청 성공이 native 기록을 복구했는지: 동일 P candidate는 다시 no-op
      await act(async () => {
        useKeyStore.setState((state) => ({
          positions: { ...state.positions, '8key': [pos(0, 0)] },
        }));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(mocks.resize).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  // 백엔드 멱등 모델: x=100에서 시작, contentMin 절대값을 저장 기준점과 비교해
  // 스스로 delta를 계산·원자 갱신 (같은 요청 재수신 = delta 0). gen 에코
  const createBackendModel = () => {
    const state = { x: 100, y: 100, width: 0, height: 0 };
    let referenceMin: { x: number; y: number } | null = null;
    const apply = (payload: {
      width: number;
      height: number;
      requestGen?: number;
      contentMin?: { x: number; y: number };
    }) => {
      if (payload.contentMin) {
        if (referenceMin) {
          state.x += payload.contentMin.x - referenceMin.x;
          state.y += payload.contentMin.y - referenceMin.y;
        }
        referenceMin = { ...payload.contentMin };
      }
      state.width = payload.width;
      state.height = payload.height;
      return {
        x: state.x,
        y: state.y,
        width: state.width,
        height: state.height,
        requestGen: payload.requestGen,
      };
    };
    return { state, apply };
  };

  const remountWithFixedPositionAnchor = async () => {
    act(() => root.unmount());
    mocks.overlayAnchor.value = 'fixed-position';
    root = createRoot(container);
    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();
  };

  it('fixed-position 확인 지연에도 contentMin 멱등으로 delta 누적 없이 정확한 위치에 도달한다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await remountWithFixedPositionAnchor();

    const backend = createBackendModel();
    mocks.resize.mockImplementation((payload) =>
      Promise.resolve(backend.apply(payload)),
    );

    vi.useFakeTimers();
    try {
      // P(minX 0) 성공 - 창 x 100, 기준점 확립
      await act(async () => {
        useKeyStore.setState(bootLikeState('8key', { '8key': [pos(0, 0)] }));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(mocks.resize).toHaveBeenCalledTimes(1);
      expect(backend.state.x).toBe(100);

      // A(minX 50): 백엔드는 적용했지만 확인이 무기한 지연 (x 150, 기준점 50)
      mocks.resize.mockImplementationOnce((payload) => {
        backend.apply(payload);
        return new Promise(() => {});
      });
      await act(async () => {
        useKeyStore.setState((state) => ({
          positions: { ...state.positions, '8key': [pos(50, 0)] },
        }));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(mocks.resize).toHaveBeenCalledTimes(2);
      expect(backend.state.x).toBe(150);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      // C(minX 20): 절대값 contentMin이라 프론트가 A의 적용 여부를 몰라도
      // 백엔드 기준점 비교로 정확한 위치 도달 - delta 누적 없음 (R7-2)
      await act(async () => {
        useKeyStore.setState((state) => ({
          positions: { ...state.positions, '8key': [pos(20, 0)] },
        }));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(mocks.resize).toHaveBeenCalledTimes(3);
      expect(lastResizePayload().contentMin).toEqual({ x: 20, y: 0 });
      expect(backend.state.x).toBe(120);
    } finally {
      vi.useRealTimers();
    }
  });

  it('응답이 유실돼도 확인 이벤트와 contentMin 멱등으로 위치가 복구된다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await remountWithFixedPositionAnchor();

    const backend = createBackendModel();
    mocks.resize.mockImplementation((payload) =>
      Promise.resolve(backend.apply(payload)),
    );

    vi.useFakeTimers();
    try {
      // P(minX 0) 성공 - 권위 확립
      await act(async () => {
        useKeyStore.setState(bootLikeState('8key', { '8key': [pos(0, 0)] }));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(backend.state.x).toBe(100);

      // A(minX 50): 응답이 영원히 유실되는 요청
      let pendingPayload: Parameters<typeof backend.apply>[0] | null = null;
      mocks.resize.mockImplementationOnce((payload) => {
        pendingPayload = payload;
        return new Promise(() => {});
      });
      await act(async () => {
        useKeyStore.setState((state) => ({
          positions: { ...state.positions, '8key': [pos(50, 0)] },
        }));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(mocks.resize).toHaveBeenCalledTimes(2);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      // 백엔드는 실제로 A를 적용했고 gen 에코 이벤트만 도착 → 리듀서 채택
      // 현재 렌더(A)와 권위가 일치하므로 보정 IPC 없음
      const appliedBounds = backend.apply(pendingPayload!);
      expect(backend.state.x).toBe(150);
      expect(appliedBounds.requestGen).toBeDefined();
      await act(async () => {
        mocks.resizedListener.current?.(appliedBounds);
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(mocks.resize).toHaveBeenCalledTimes(2);

      // P 복귀: 채택된 권위(minX 50) 기준 delta -50으로 창이 x 100 복원
      await act(async () => {
        useKeyStore.setState((state) => ({
          positions: { ...state.positions, '8key': [pos(0, 0)] },
        }));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(mocks.resize).toHaveBeenCalledTimes(3);
      expect(backend.state.x).toBe(100);
    } finally {
      vi.useRealTimers();
    }
  });

  it('타임아웃 전 도착한 확인 이벤트도 유실 없이 화해에 반영된다', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await remountWithFixedPositionAnchor();

    const backend = createBackendModel();
    mocks.resize.mockImplementation((payload) =>
      Promise.resolve(backend.apply(payload)),
    );

    vi.useFakeTimers();
    try {
      // P(minX 0) 성공 - 권위 확립
      await act(async () => {
        useKeyStore.setState(bootLikeState('8key', { '8key': [pos(0, 0)] }));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(backend.state.x).toBe(100);

      // A(minX 50): 응답은 영원히 유실, 백엔드는 즉시 적용해 이벤트 발행
      let pendingPayload: Parameters<typeof backend.apply>[0] | null = null;
      mocks.resize.mockImplementationOnce((payload) => {
        pendingPayload = payload;
        return new Promise(() => {});
      });
      await act(async () => {
        useKeyStore.setState((state) => ({
          positions: { ...state.positions, '8key': [pos(50, 0)] },
        }));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(mocks.resize).toHaveBeenCalledTimes(2);

      // 타임아웃 전에 이벤트 도착 - 버리지 않고 리듀서로 채택
      const appliedBounds = backend.apply(pendingPayload!);
      expect(backend.state.x).toBe(150);
      await act(async () => {
        mocks.resizedListener.current?.(appliedBounds);
        await vi.advanceTimersByTimeAsync(0);
      });

      // 타임아웃 경과 후 P 복귀: 이미 채택된 권위 덕에 지연 없이 delta -50 디스패치
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      await act(async () => {
        useKeyStore.setState((state) => ({
          positions: { ...state.positions, '8key': [pos(0, 0)] },
        }));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('deferred'),
      );
      expect(mocks.resize).toHaveBeenCalledTimes(3);
      expect(backend.state.x).toBe(100);
    } finally {
      vi.useRealTimers();
    }
  });

  it('실패 직전 재코얼레스된 동일 params 대기가 no-op으로 폐기되지 않는다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // P 성공
    await act(async () => {
      useKeyStore.setState(bootLikeState('8key', { '8key': [pos(0, 0)] }));
    });
    await flushAsync();
    expect(mocks.resize).toHaveBeenCalledTimes(1);

    // A(220): pending in-flight
    const lateA = deferred<{
      x: number;
      y: number;
      width: number;
      height: number;
    }>();
    mocks.resize.mockReturnValueOnce(lateA.promise);
    await act(async () => {
      useKeyStore.setState((state) => ({
        positions: { ...state.positions, '8key': [pos(0, 0), pos(100, 0)] },
      }));
    });
    await flushAsync();
    expect(mocks.resize).toHaveBeenCalledTimes(2);

    // B(320) 도착 후 다시 A로 재코얼레스 - 대기 슬롯 최종값이 in-flight A와 동일
    await act(async () => {
      useKeyStore.setState((state) => ({
        positions: { ...state.positions, '8key': [pos(0, 0), pos(200, 0)] },
      }));
    });
    await act(async () => {
      useKeyStore.setState((state) => ({
        positions: { ...state.positions, '8key': [pos(0, 0), pos(100, 0)] },
      }));
    });
    await flushAsync();
    expect(mocks.resize).toHaveBeenCalledTimes(2);

    // A 실패: last-sent 무효화 → settle이 동일 params 대기(A)를 no-op으로
    // 폐기하지 않고 재발행 (R7-3)
    await act(async () => {
      lateA.reject(new Error('ipc down'));
    });
    await flushAsync();
    expect(mocks.resize).toHaveBeenCalledTimes(3);
    expect(lastResizePayload().width).toBe(220);
    expect(lastSceneProps()?.displayPositions).toHaveLength(2);
  });

  it('gen 없는 resized 이벤트도 화해 루프로 창을 last-sent 목표로 복원한다 (하위 호환)', async () => {
    // P 성공 - last-sent 120x420
    await act(async () => {
      useKeyStore.setState(bootLikeState('8key', { '8key': [pos(0, 0)] }));
    });
    await flushAsync();
    expect(mocks.resize).toHaveBeenCalledTimes(1);

    // 구 백엔드/외부 리사이즈: gen 없는 이벤트가 목표와 다른 실창을 보고 →
    // 화해 루프가 목표(120)로 즉시 보정 재발행
    await act(async () => {
      mocks.resizedListener.current?.({ x: 0, y: 0, width: 130, height: 420 });
    });
    await flushAsync();
    expect(mocks.resize).toHaveBeenCalledTimes(2);
    expect(lastResizePayload().width).toBe(120);
  });

  it('검증된 롤백 Err 후 이벤트 화해로 창과 렌더가 일치한다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const backend = createBackendModel();
    mocks.resize.mockImplementation((payload) =>
      Promise.resolve(backend.apply(payload)),
    );

    // P 성공 - 창 너비 120
    await act(async () => {
      useKeyStore.setState(bootLikeState('8key', { '8key': [pos(0, 0)] }));
    });
    await flushAsync();
    expect(backend.state.width).toBe(120);

    // A(220): 크기 적용 후 위치 실패 - 검증된 롤백으로 원상 복구.
    // 백엔드 실제 순서: 롤백 exit에서 실측 이벤트 발행(선행) 후 Err 응답(후행)
    mocks.resize.mockImplementationOnce((payload) => {
      backend.apply(payload);
      backend.state.width = 120;
      backend.state.height = 420;
      mocks.resizedListener.current?.({
        x: backend.state.x,
        y: backend.state.y,
        width: backend.state.width,
        height: backend.state.height,
        requestGen: (payload as { requestGen?: number }).requestGen,
      });
      return Promise.reject(new Error('position failed; rolled back'));
    });
    await act(async () => {
      useKeyStore.setState((state) => ({
        positions: { ...state.positions, '8key': [pos(0, 0), pos(100, 0)] },
      }));
    });
    await flushAsync();
    // 선행 이벤트는 in-flight 중 기록되고 후행 rejection의 settle에서 화해 발동
    // → 목표(220)로 보정 재발행되어 창·렌더 일치
    expect(mocks.resize).toHaveBeenCalledTimes(3);
    expect(lastSceneProps()?.displayPositions).toHaveLength(2);
    expect(backend.state.width).toBe(220);

    // 연속 보정 1회 제한: 달성 확인 없이 또 불일치 이벤트 → 재발행 없음
    await act(async () => {
      mocks.resizedListener.current?.({
        x: 100,
        y: 100,
        width: 130,
        height: 420,
      });
    });
    await flushAsync();
    expect(mocks.resize).toHaveBeenCalledTimes(3);

    // 목표 달성 이벤트로 카운터 리셋 → 이후 불일치는 다시 보정 가능
    await act(async () => {
      mocks.resizedListener.current?.({
        x: 100,
        y: 100,
        width: 220,
        height: 420,
      });
      mocks.resizedListener.current?.({
        x: 100,
        y: 100,
        width: 130,
        height: 420,
      });
    });
    await flushAsync();
    expect(mocks.resize).toHaveBeenCalledTimes(4);
    expect(backend.state.width).toBe(220);
  });

  it('wire: contentMin을 항상 포함하고 구 delta 필드는 보내지 않는다', async () => {
    await act(async () => {
      useKeyStore.setState(bootLikeState('8key', { '8key': [pos(0, 0)] }));
    });
    await flushAsync();
    expect(mocks.resize).toHaveBeenCalledTimes(1);

    const payload = mocks.resize.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    expect(payload.contentMin).toEqual({ x: 0, y: 0 });
    expect('fixedPositionDeltaX' in payload).toBe(false);
    expect('fixedPositionDeltaY' in payload).toBe(false);
  });

  it('partial 오류 후에도 복귀 candidate가 재발행된다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await remountWithFixedPositionAnchor();

    const backend = createBackendModel();
    mocks.resize.mockImplementation((payload) =>
      Promise.resolve(backend.apply(payload)),
    );

    // P(gen1, width 120) 성공 - 권위 확립
    await act(async () => {
      useKeyStore.setState(bootLikeState('8key', { '8key': [pos(0, 0)] }));
    });
    await flushAsync();
    expect(mocks.resize).toHaveBeenCalledTimes(1);
    expect(backend.state.width).toBe(120);

    // A(gen2, width 220): 크기는 적용됐지만 위치 롤백까지 실패한 partial
    mocks.resize.mockImplementationOnce((payload) => {
      const applied = backend.apply(payload);
      return Promise.reject({
        errorCode: 'OVERLAY_RESIZE_PARTIAL',
        details: { requestGen: applied.requestGen, appliedBounds: applied },
        retryable: false,
      });
    });
    await act(async () => {
      useKeyStore.setState((state) => ({
        positions: { ...state.positions, '8key': [pos(0, 0), pos(100, 0)] },
      }));
    });
    await flushAsync();
    expect(mocks.resize).toHaveBeenCalledTimes(2);
    expect(backend.state.width).toBe(220);
    // 렌더는 승격되고 권위는 실측 220으로 채택됨
    expect(lastSceneProps()?.displayPositions).toHaveLength(2);

    // P 복귀: 미적용 확정으로 오인하면 no-op으로 눌려 창이 220에 고착 -
    // 실측 채택 덕에 보정 IPC가 나가 창이 120으로 복원
    await act(async () => {
      useKeyStore.setState((state) => ({
        positions: { ...state.positions, '8key': [pos(0, 0)] },
      }));
    });
    await flushAsync();
    expect(mocks.resize).toHaveBeenCalledTimes(3);
    expect(backend.state.width).toBe(120);
  });

  it('백엔드 최소 크기 미만 요청은 100으로 정규화해 보내고 동일 candidate 재발행 시 IPC를 생략한다', async () => {
    await act(async () => {
      useKeyStore.setState(
        bootLikeState('8key', {
          '8key': [pos(0, 0, { width: 30, height: 30 })],
        }),
      );
    });
    await flushAsync();

    expect(mocks.resize).toHaveBeenCalledTimes(1);
    expect(lastResizePayload().width).toBe(100);

    // 동일 값의 새 candidate: 응답(100)과 정규화 요청(100)이 일치해 no-op
    await act(async () => {
      useKeyStore.setState((state) => ({
        positions: {
          ...state.positions,
          '8key': [pos(0, 0, { width: 30, height: 30 })],
        },
      }));
    });
    await flushAsync();
    expect(mocks.resize).toHaveBeenCalledTimes(1);
    expect(lastSceneProps()?.displayPositions).toHaveLength(1);
  });

  it('소수 치수는 백엔드와 동일하게 반올림해 재-IPC를 막는다', async () => {
    await act(async () => {
      useKeyStore.setState(
        bootLikeState('8key', { '8key': [pos(0, 0, { width: 60.5 })] }),
      );
    });
    await flushAsync();

    // 120.5 → 121 (round half away from zero, 백엔드 f64::round와 동일)
    expect(mocks.resize).toHaveBeenCalledTimes(1);
    expect(lastResizePayload().width).toBe(121);

    await act(async () => {
      useKeyStore.setState((state) => ({
        positions: { ...state.positions, '8key': [pos(0, 0, { width: 60.5 })] },
      }));
    });
    await flushAsync();
    expect(mocks.resize).toHaveBeenCalledTimes(1);
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
