import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom에는 ResizeObserver가 없다 - 훅은 실제 브라우저 API를 쓰므로 최소 스텁만 제공
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver =
  ResizeObserverStub as unknown as typeof ResizeObserver;

const mocks = vi.hoisted(() => ({
  // ready handshake는 epoch를 돌려줘야 발행이 열린다
  invoke: vi.fn(
    (command: string): Promise<unknown> =>
      command === 'overlay_hit_renderer_ready'
        ? Promise.resolve({ epoch: 1 })
        : Promise.resolve(),
  ),
  handlers: new Map<string, (payload: unknown) => void>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@api/modules/shared', () => ({
  subscribe: vi.fn((event: string, handler: (payload: unknown) => void) => {
    mocks.handlers.set(event, handler);
    return Object.assign(() => mocks.handlers.delete(event), {
      ready: Promise.resolve(),
    });
  }),
}));

const STORAGE_KEY = 'dmnote:overlay-hit-revision';
// useOverlayHitRegions.ts의 REVISION_LEASE_SPAN과 동일해야 함
const LEASE_SPAN = 10_000_000;

const sentRevisions = () =>
  (
    mocks.invoke.mock.calls as unknown as [
      string,
      { payload: { revision: number } },
    ][]
  )
    .filter(([command]) => command === 'overlay_sync_hit_regions')
    .map(([, args]) => args.payload.revision);

// 훅을 마운트하고 더블 rAF를 소진해 실제 발급 경로로 sync를 발생시킨다
const runHookSession = async (): Promise<Root> => {
  const { useOverlayHitRegions } = await import('./useOverlayHitRegions');
  const Probe = () => {
    useOverlayHitRegions(1);
    return null;
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(React.createElement(Probe));
  });
  await act(async () => {
    vi.advanceTimersByTime(64);
  });
  // handshake가 epoch를 채운 뒤의 재측정까지 소진한다
  await act(async () => {
    vi.advanceTimersByTime(64);
  });
  return root!;
};

describe('overlay hit revision lease', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    mocks.handlers.clear();
    vi.useFakeTimers();
    mocks.invoke.mockClear();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('로드 시 발급 상한을 미리 저장해 크래시 후에도 단조성이 유지된다', async () => {
    const now = 2_000_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);

    await import('./useOverlayHitRegions');

    // 이번 세션이 발급할 수 있는 최대값이 이미 저장됨 - 어느 시점에
    // 크래시해도 다음 세션은 이보다 큰 값에서 시작
    expect(Number(window.localStorage.getItem(STORAGE_KEY))).toBe(
      now + LEASE_SPAN,
    );
  });

  it('크래시성 재로드 + 시계 역행 후에도 실제 발급 revision이 증가한다', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000_000_000_000);
    const firstRoot = await runHookSession();
    const firstSessionRevisions = sentRevisions();
    expect(firstSessionRevisions.length).toBeGreaterThan(0);
    const lastIssued = Math.max(...firstSessionRevisions);

    // pagehide 없는 크래시성 재로드 모사 + 시계 역행
    await act(async () => {
      firstRoot.unmount();
    });
    vi.resetModules();
    mocks.invoke.mockClear();
    vi.spyOn(Date, 'now').mockReturnValue(1_900_000_000_000);

    const secondRoot = await runHookSession();
    const secondSessionRevisions = sentRevisions();
    expect(secondSessionRevisions.length).toBeGreaterThan(0);
    expect(Math.min(...secondSessionRevisions)).toBeGreaterThan(lastIssued);

    await act(async () => {
      secondRoot.unmount();
    });
  });

  it('손상된 저장값은 무시하고 시각 시드로 폴백한다', async () => {
    window.localStorage.setItem(STORAGE_KEY, '1e308');
    const now = 2_000_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);

    await import('./useOverlayHitRegions');

    expect(Number(window.localStorage.getItem(STORAGE_KEY))).toBe(
      now + LEASE_SPAN,
    );
  });

  it('상한 근처의 정상 저장값을 손상값으로 오인하지 않는다', async () => {
    const nearMax = Number.MAX_SAFE_INTEGER - 100;
    const { computeRevisionSeed, computeLeaseEnd } = await import(
      './useOverlayHitRegions'
    );

    // 정상 기록된 상한 근처 lease를 이어가고 시각 시드로 낮추지 않음
    expect(computeRevisionSeed(String(nearMax), 2_000_000_000_000)).toBe(
      nearMax + 1,
    );
    // lease 상한은 안전 정수 경계에서 포화
    expect(computeLeaseEnd(nearMax + 1)).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('overlay hit 발행 판정', () => {
  const rects = [{ x: 10, y: 20, width: 30, height: 40 }];
  const same = [{ x: 10, y: 20, width: 30, height: 40 }];

  const load = async () => {
    const { shouldPublishHitRegions } = await import('./useOverlayHitRegions');
    return shouldPublishHitRegions;
  };

  it('rect와 배율이 모두 같으면 발행하지 않는다', async () => {
    const shouldPublish = await load();
    expect(shouldPublish(rects, 1.5, same, 1.5)).toBe(false);
  });

  it('rect가 같아도 배율이 바뀌면 발행한다', async () => {
    // 150% 화면에서 히트 영역이 보이는 위치의 1/1.5 지점에 생기던 회귀
    const shouldPublish = await load();
    expect(shouldPublish(rects, 1, same, 1.5)).toBe(true);
  });

  it('배율이 같아도 rect가 바뀌면 발행한다', async () => {
    const shouldPublish = await load();
    expect(shouldPublish(rects, 1.5, [{ ...rects[0], x: 11 }], 1.5)).toBe(true);
  });

  it('첫 발행은 항상 내보낸다', async () => {
    const shouldPublish = await load();
    expect(shouldPublish(null, null, rects, 1)).toBe(true);
  });
});

describe('overlay hit 표시 요소 수집', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    mocks.handlers.clear();
    mocks.invoke.mockClear();
    vi.useFakeTimers();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('공용 표식이 있는 키·스탯·그래프·노브·플러그인을 모두 발행한다', async () => {
    const expected = ['key', 'stat', 'graph', 'knob', 'plugin'].map(
      (kind, index) => {
        const node = document.createElement('div');
        node.dataset.overlayHit = 'true';
        node.dataset.kind = kind;
        vi.spyOn(node, 'getBoundingClientRect').mockReturnValue({
          x: index * 20,
          y: index * 10,
          left: index * 20,
          top: index * 10,
          right: index * 20 + 10,
          bottom: index * 10 + 10,
          width: 10,
          height: 10,
          toJSON: () => ({}),
        } as DOMRect);
        document.body.appendChild(node);
        return { x: index * 20, y: index * 10, width: 10, height: 10 };
      },
    );

    const root = await runHookSession();
    const syncCall = (
      mocks.invoke.mock.calls as unknown as [
        string,
        { payload: { rects: Array<Record<string, number>> } },
      ][]
    ).find(([command]) => command === 'overlay_sync_hit_regions');

    expect(syncCall?.[1].payload.rects).toEqual(expected);

    await act(async () => root.unmount());
  });

  it('마운트 뒤 추가된 표시 요소도 generation 변경 없이 다시 발행한다', async () => {
    const root = await runHookSession();
    const initialSyncCount = (
      mocks.invoke.mock.calls as unknown as [string, unknown][]
    ).filter(([command]) => command === 'overlay_sync_hit_regions').length;

    const node = document.createElement('div');
    node.dataset.overlayHit = 'true';
    vi.spyOn(node, 'getBoundingClientRect').mockReturnValue({
      x: 12,
      y: 34,
      left: 12,
      top: 34,
      right: 68,
      bottom: 112,
      width: 56,
      height: 78,
      toJSON: () => ({}),
    } as DOMRect);

    await act(async () => {
      document.body.appendChild(node);
      await Promise.resolve();
      vi.advanceTimersByTime(64);
    });

    const syncCalls = (
      mocks.invoke.mock.calls as unknown as [
        string,
        {
          payload: {
            rects: Array<{
              x: number;
              y: number;
              width: number;
              height: number;
            }>;
          };
        },
      ][]
    ).filter(([command]) => command === 'overlay_sync_hit_regions');
    expect(syncCalls).toHaveLength(initialSyncCount + 1);
    expect(syncCalls.at(-1)?.[1].payload.rects).toEqual([
      { x: 12, y: 34, width: 56, height: 78 },
    ]);

    await act(async () => root.unmount());
  });
});

describe('overlay hit 재동기화 요청', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    mocks.handlers.clear();
    mocks.invoke.mockClear();
    vi.useFakeTimers();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const syncCalls = () =>
    (mocks.invoke.mock.calls as unknown as [string, unknown][]).filter(
      ([command]) => command === 'overlay_sync_hit_regions',
    );

  it('요청을 받으면 좌표가 같아도 다시 발행한다', async () => {
    const root = await runHookSession();
    expect(syncCalls()).toHaveLength(1);

    // 같은 좌표로 재측정만 걸면 중복 제거에 막힌다
    await act(async () => {
      mocks.handlers.get('css:use')?.(undefined);
      vi.advanceTimersByTime(64);
    });
    expect(syncCalls()).toHaveLength(1);

    // 재동기화 요청은 그 기준선을 지우므로 반드시 다시 나간다
    await act(async () => {
      mocks.handlers.get('overlay:hit-resync')?.({
        epoch: 2,
        reason: 'parent-changed',
      });
      vi.advanceTimersByTime(64);
    });
    const calls = syncCalls();
    expect(calls).toHaveLength(2);
    expect((calls[1][1] as { payload: { epoch: number } }).payload.epoch).toBe(
      2,
    );

    await act(async () => {
      root.unmount();
    });
  });

  it('역행하는 epoch는 무시한다', async () => {
    const root = await runHookSession();
    expect(syncCalls()).toHaveLength(1);

    await act(async () => {
      mocks.handlers.get('overlay:hit-resync')?.({
        epoch: 0,
        reason: 'probe',
      });
      vi.advanceTimersByTime(64);
    });
    expect(syncCalls()).toHaveLength(1);

    await act(async () => {
      root.unmount();
    });
  });
});

describe('overlay hit lease 회수', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    mocks.handlers.clear();
    mocks.invoke.mockClear();
    vi.useFakeTimers();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const callsOf = (command: string) =>
    (mocks.invoke.mock.calls as unknown as [string, unknown][]).filter(
      ([name]) => name === command,
    );

  it('채택 거부를 받으면 준비를 다시 알려 lease를 되찾는다', async () => {
    const root = await runHookSession();
    expect(callsOf('overlay_hit_renderer_ready')).toHaveLength(1);

    // 죽은 세션이 lease를 가져간 상태를 흉내낸다
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'overlay_hit_renderer_ready') {
        return Promise.resolve({ epoch: 3 });
      }
      return Promise.resolve({ accepted: false });
    });

    // 재호출 최소 간격을 넘긴다
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    await act(async () => {
      mocks.handlers.get('overlay:hit-resync')?.({
        epoch: 2,
        reason: 'probe',
      });
      vi.advanceTimersByTime(64);
    });

    expect(callsOf('overlay_hit_renderer_ready')).toHaveLength(2);

    await act(async () => {
      root.unmount();
    });
  });
});
