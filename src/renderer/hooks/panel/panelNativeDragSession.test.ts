import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Windows 네이티브 드래그 세션 - 종료 권위·terminalPending·stale gestureId 계약 검증

type Listener = (payload: {
  gestureId: string;
  [key: string]: unknown;
}) => void;

const mocks = vi.hoisted(() => ({
  hintListeners: [] as Listener[],
  endedListeners: [] as Listener[],
  dragHitTest: vi.fn(),
  dragPresentAndStart: vi.fn(),
  dragStartExisting: vi.fn(),
  dragDisarmDockZone: vi.fn(),
  dockPropertiesPanel: vi.fn(),
  detachPropertiesPanel: vi.fn(),
  hostState: { transition: 'idle' as string },
  storeSubscribers: [] as ((state: { transition: string }) => void)[],
  hintReady: Promise.resolve() as Promise<void>,
  endedReady: Promise.resolve() as Promise<void>,
  panelChildWindow: null as { window: { devicePixelRatio: number } } | null,
}));

vi.mock('@api/modules/window/panelWindowApi', () => ({
  panelWindowApi: {
    onDragHint: (listener: Listener) => {
      mocks.hintListeners.push(listener);
      return Object.assign(() => {}, { ready: mocks.hintReady });
    },
    onDragEnded: (listener: Listener) => {
      mocks.endedListeners.push(listener);
      return Object.assign(() => {}, { ready: mocks.endedReady });
    },
    dragHitTest: (...args: unknown[]) => mocks.dragHitTest(...args),
    dragPresentAndStart: (...args: unknown[]) =>
      mocks.dragPresentAndStart(...args),
    dragStartExisting: (...args: unknown[]) => mocks.dragStartExisting(...args),
    dragDisarmDockZone: (...args: unknown[]) =>
      mocks.dragDisarmDockZone(...args),
  },
}));

vi.mock('@stores/grid/usePanelHostStore', () => ({
  detachPropertiesPanel: (...args: unknown[]) =>
    mocks.detachPropertiesPanel(...args),
  dockPropertiesPanel: (...args: unknown[]) =>
    mocks.dockPropertiesPanel(...args),
  usePanelHostStore: {
    getState: () => mocks.hostState,
    subscribe: (fn: (state: { transition: string }) => void) => {
      mocks.storeSubscribers.push(fn);
      return () => {};
    },
  },
}));

vi.mock('@utils/panelWindow/panelChildWindow', () => ({
  getPanelChildWindow: () => mocks.panelChildWindow,
}));

import { startNativePanelDrag } from './panelNativeDragSession';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const geometry = (
  overrides: Partial<Parameters<typeof startNativePanelDrag>[0]> = {},
) => ({
  gestureId: 'g1',
  origin: 'detached' as const,
  grabOffsetCss: { x: 10, y: 5 },
  pressClientCss: { x: 100, y: 50 },
  dockAreaCss: null,
  mainDevicePixelRatio: 1,
  panelDevicePixelRatio: 1 as number | null,
  ...overrides,
});

const callbacks = (
  overrides: Partial<Parameters<typeof startNativePanelDrag>[1]> = {},
) => ({
  dockAreaAlive: () => true,
  snapBackPx: 30,
  onDockHint: vi.fn(),
  onFinished: vi.fn(),
  ...overrides,
});

const emitEnded = (
  gestureId: string,
  outcome: string,
  wouldSnapBack?: boolean,
) => {
  for (const listener of [...mocks.endedListeners]) {
    listener({ gestureId, outcome, wouldSnapBack });
  }
};

const emitHint = (gestureId: string, wouldDock: boolean) => {
  for (const listener of [...mocks.hintListeners]) {
    listener({ gestureId, wouldDock });
  }
};

describe('startNativePanelDrag', () => {
  beforeEach(() => {
    mocks.hintListeners.length = 0;
    mocks.endedListeners.length = 0;
    mocks.storeSubscribers.length = 0;
    mocks.hostState.transition = 'idle';
    mocks.hintReady = Promise.resolve();
    mocks.endedReady = Promise.resolve();
    mocks.panelChildWindow = null;
    mocks.dragHitTest.mockResolvedValue({ gestureId: 'g1', wouldDock: true });
    mocks.dragPresentAndStart.mockResolvedValue(undefined);
    mocks.dragStartExisting.mockResolvedValue(undefined);
    mocks.dockPropertiesPanel.mockResolvedValue('done');
    mocks.dragDisarmDockZone.mockResolvedValue(undefined);
    mocks.detachPropertiesPanel.mockImplementation(
      async (options: { present?: () => Promise<void> }) => {
        await options.present?.();
        return 'done';
      },
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('released면 hit-test 후 wouldDock에 따라 도킹한다', async () => {
    const cb = callbacks();
    startNativePanelDrag(geometry(), cb);
    await flush();
    expect(mocks.dragStartExisting).toHaveBeenCalledTimes(1);

    emitEnded('g1', 'released');
    await flush();
    expect(mocks.dragHitTest).toHaveBeenCalledTimes(1);
    expect(mocks.dockPropertiesPanel).toHaveBeenCalledTimes(1);
    expect(cb.onFinished).toHaveBeenCalledTimes(1);
  });

  it('docked origin은 detachPropertiesPanel의 present 자리로 인계한다', async () => {
    startNativePanelDrag(geometry({ origin: 'docked' }), callbacks());
    await flush();
    expect(mocks.detachPropertiesPanel).toHaveBeenCalledTimes(1);
    expect(mocks.dragPresentAndStart).toHaveBeenCalledTimes(1);
    expect(mocks.dragStartExisting).not.toHaveBeenCalled();
  });

  it('첫 tear-off는 창 생성 뒤 present 직전에 패널 DPR을 다시 실측한다', async () => {
    // 자식 창 없음 -> detach 전환 안에서 생성 -> 재실측 -> 커맨드 전달 순서 고정.
    // mousedown 시점 null이 굳으면 비대칭 줌 실패에서 seed가 main residual로 흐른다
    mocks.detachPropertiesPanel.mockImplementation(
      async (options: { present?: () => Promise<void> }) => {
        mocks.panelChildWindow = { window: { devicePixelRatio: 1.25 } };
        await options.present?.();
        return 'done';
      },
    );
    startNativePanelDrag(
      geometry({ origin: 'docked', panelDevicePixelRatio: null }),
      callbacks(),
    );
    await flush();
    expect(mocks.dragPresentAndStart).toHaveBeenCalledTimes(1);
    expect(mocks.dragPresentAndStart.mock.calls[0][0]).toMatchObject({
      panelDevicePixelRatio: 1.25,
    });
  });

  it('present 직전에도 창을 못 읽으면 stale 값 대신 null을 보낸다', async () => {
    // 출처 보존 - 패널 창을 못 읽었으면 null이어야 백엔드가 main residual로 폴백한다
    startNativePanelDrag(
      geometry({ origin: 'docked', panelDevicePixelRatio: 2 }),
      callbacks(),
    );
    await flush();
    expect(mocks.dragPresentAndStart).toHaveBeenCalledTimes(1);
    expect(mocks.dragPresentAndStart.mock.calls[0][0]).toMatchObject({
      panelDevicePixelRatio: null,
    });
  });

  it('stale gestureId의 종료 이벤트는 무시한다', async () => {
    const cb = callbacks();
    startNativePanelDrag(geometry(), cb);
    await flush();

    emitEnded('other-gesture', 'released');
    await flush();
    expect(mocks.dragHitTest).not.toHaveBeenCalled();
    expect(cb.onFinished).not.toHaveBeenCalled();
  });

  it('detached에서 도크 존이 사라졌으면 hit-test 없이 그 자리에 둔다', async () => {
    const cb = callbacks({ dockAreaAlive: () => false });
    startNativePanelDrag(geometry(), cb);
    await flush();

    emitEnded('g1', 'released');
    await flush();
    expect(mocks.dragHitTest).not.toHaveBeenCalled();
    expect(mocks.dockPropertiesPanel).not.toHaveBeenCalled();
    expect(cb.onFinished).toHaveBeenCalledTimes(1);
  });

  it('escaped + docked는 hit-test 없이 제자리로 도킹한다', async () => {
    startNativePanelDrag(geometry({ origin: 'docked' }), callbacks());
    await flush();

    emitEnded('g1', 'escaped');
    await flush();
    expect(mocks.dragHitTest).not.toHaveBeenCalled();
    expect(mocks.dockPropertiesPanel).toHaveBeenCalledTimes(1);
  });

  it('escaped + detached는 OS가 복원한 자리 그대로 둔다', async () => {
    startNativePanelDrag(geometry(), callbacks());
    await flush();

    emitEnded('g1', 'escaped');
    await flush();
    expect(mocks.dockPropertiesPanel).not.toHaveBeenCalled();
  });

  it('인계 전 해제는 스냅백 반경 안이면 도킹한다', async () => {
    // present가 끝나지 않아 phase가 starting에 머무는 상황
    mocks.detachPropertiesPanel.mockImplementation(() => new Promise(() => {}));
    const handle = startNativePanelDrag(
      geometry({ origin: 'docked' }),
      callbacks(),
    );
    await flush();

    handle.noteDomMouseUp({ x: 110, y: 60 });
    emitEnded('g1', 'releasedBeforeStart');
    await flush();
    expect(mocks.dragHitTest).not.toHaveBeenCalled();
    expect(mocks.dockPropertiesPanel).toHaveBeenCalledTimes(1);
  });

  it('인계 전 해제가 반경 밖이면 seed 자리에 남긴다', async () => {
    mocks.detachPropertiesPanel.mockImplementation(() => new Promise(() => {}));
    const handle = startNativePanelDrag(
      geometry({ origin: 'docked' }),
      callbacks(),
    );
    await flush();

    handle.noteDomMouseUp({ x: 300, y: 200 });
    emitEnded('g1', 'releasedBeforeStart');
    await flush();
    expect(mocks.dockPropertiesPanel).not.toHaveBeenCalled();
  });

  it('전환이 idle이 아니면 terminal을 예약했다가 idle 후 한 번만 처리한다', async () => {
    const cb = callbacks();
    startNativePanelDrag(geometry(), cb);
    await flush();

    mocks.hostState.transition = 'detaching';
    emitEnded('g1', 'released');
    await flush();
    expect(mocks.dragHitTest).not.toHaveBeenCalled();

    mocks.hostState.transition = 'idle';
    for (const fn of mocks.storeSubscribers) fn({ transition: 'idle' });
    await flush();
    expect(mocks.dragHitTest).toHaveBeenCalledTimes(1);
    expect(cb.onFinished).toHaveBeenCalledTimes(1);

    // 중복 종료 이벤트는 무시된다
    emitEnded('g1', 'released');
    await flush();
    expect(mocks.dragHitTest).toHaveBeenCalledTimes(1);
  });

  it('드래그 중 힌트는 도크 존 생존 여부를 함께 반영한다', async () => {
    const cb = callbacks();
    startNativePanelDrag(geometry(), cb);
    await flush();

    emitHint('g1', true);
    expect(cb.onDockHint).toHaveBeenCalledWith(true);
    emitHint('other-gesture', true);
    expect(cb.onDockHint).toHaveBeenCalledTimes(1);
  });

  it('커맨드 응답보다 먼저 온 첫 힌트도 수용한다', async () => {
    // 백엔드가 값 변화 때만 발행하므로 starting 단계 힌트를 버리면 다시 오지 않는다
    mocks.detachPropertiesPanel.mockImplementation(() => new Promise(() => {}));
    const cb = callbacks();
    startNativePanelDrag(geometry({ origin: 'docked' }), cb);
    await flush();

    emitHint('g1', true);
    expect(cb.onDockHint).toHaveBeenCalledWith(true);
  });

  it('terminal 이후 힌트는 무시한다', async () => {
    const cb = callbacks();
    startNativePanelDrag(geometry(), cb);
    await flush();

    emitEnded('g1', 'released');
    await flush();
    emitHint('g1', true);
    expect(cb.onDockHint).not.toHaveBeenCalled();
  });

  it('백엔드 스냅백 판정은 DOM mouseup 없이도 도킹한다', async () => {
    // 이벤트가 DOM mouseup보다 먼저 온 경우 - releaseClient가 없어도 payload가 판정을 나른다
    mocks.detachPropertiesPanel.mockImplementation(() => new Promise(() => {}));
    startNativePanelDrag(geometry({ origin: 'docked' }), callbacks());
    await flush();

    emitEnded('g1', 'releasedBeforeStart', true);
    await flush();
    expect(mocks.dockPropertiesPanel).toHaveBeenCalledTimes(1);
  });

  it('백엔드 스냅백 false는 프론트 기록보다 우선한다', async () => {
    mocks.detachPropertiesPanel.mockImplementation(() => new Promise(() => {}));
    const handle = startNativePanelDrag(
      geometry({ origin: 'docked' }),
      callbacks(),
    );
    await flush();

    handle.noteDomMouseUp({ x: 101, y: 51 });
    emitEnded('g1', 'releasedBeforeStart', false);
    await flush();
    expect(mocks.dockPropertiesPanel).not.toHaveBeenCalled();
  });

  it('terminal 도킹이 busy면 idle을 다시 기다려 재시도한다', async () => {
    mocks.dockPropertiesPanel
      .mockResolvedValueOnce('busy')
      .mockResolvedValueOnce('done');
    startNativePanelDrag(geometry(), callbacks());
    await flush();

    emitEnded('g1', 'released');
    await flush();
    expect(mocks.dockPropertiesPanel).toHaveBeenCalledTimes(2);
  });

  it('도크 존이 사라진 채 도킹 힌트가 오면 즉시 무효화를 보낸다', async () => {
    const cb = callbacks({ dockAreaAlive: () => false });
    startNativePanelDrag(geometry(), cb);
    await flush();

    emitHint('g1', true);
    expect(mocks.dragDisarmDockZone).toHaveBeenCalledWith('g1');
    expect(cb.onDockHint).toHaveBeenCalledWith(false);
  });

  it('이벤트 구독 실패도 세션을 정리하고 끝낸다', async () => {
    // listen() 거부가 세션을 영구 점유하면 이후 드래그가 전부 막힌다
    mocks.hintReady = Promise.reject(new Error('listen failed'));
    mocks.hintReady.catch(() => {});
    const cb = callbacks();
    startNativePanelDrag(geometry(), cb);
    await flush();

    expect(mocks.dragStartExisting).not.toHaveBeenCalled();
    expect(mocks.dockPropertiesPanel).not.toHaveBeenCalled();
    expect(cb.onFinished).toHaveBeenCalledTimes(1);
  });

  it('생명주기 취소는 도킹 없이 세션만 정리한다', async () => {
    const cb = callbacks();
    startNativePanelDrag(geometry({ origin: 'docked' }), cb);
    await flush();

    emitEnded('g1', 'canceled');
    await flush();
    expect(mocks.dragHitTest).not.toHaveBeenCalled();
    expect(mocks.dockPropertiesPanel).not.toHaveBeenCalled();
    expect(cb.onFinished).toHaveBeenCalledTimes(1);
  });

  it('hit-test 실패는 도킹하지 않고 세션만 끝낸다', async () => {
    mocks.dragHitTest.mockRejectedValue(new Error('backend down'));
    const cb = callbacks();
    startNativePanelDrag(geometry(), cb);
    await flush();

    emitEnded('g1', 'released');
    await flush();
    expect(mocks.dockPropertiesPanel).not.toHaveBeenCalled();
    expect(cb.onFinished).toHaveBeenCalledTimes(1);
  });
});
