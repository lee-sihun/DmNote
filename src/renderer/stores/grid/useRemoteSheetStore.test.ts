import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  showMain: vi.fn(() => Promise.resolve()),
  request: vi.fn((_request: unknown) => Promise.resolve()),
  abort: vi.fn((_requestId: string) => Promise.resolve()),
  accepted: null as null | ((payload: { requestId: string }) => void),
  closed: null as null | ((result: unknown) => void),
  hostReady: null as null | (() => void),
}));

vi.mock('@api/modules/appApi', () => ({
  windowApi: { showMain: () => mocks.showMain() },
}));
vi.mock('@api/modules/remoteSheetApi', () => ({
  remoteSheetApi: {
    request: (request: unknown) => mocks.request(request),
    abort: (requestId: string) => mocks.abort(requestId),
    onAccepted: (listener: (payload: { requestId: string }) => void) => {
      mocks.accepted = listener;
      return () => {};
    },
    onClosed: (listener: (result: unknown) => void) => {
      mocks.closed = listener;
      return () => {};
    },
    onHostReady: (listener: () => void) => {
      mocks.hostReady = listener;
      return () => {};
    },
  },
}));

import {
  isRemoteSheetActive,
  listenRemoteSheetHost,
  openRemoteSheet,
  resetRemoteSheetForTests,
  useRemoteSheetStore,
} from './useRemoteSheetStore';

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe('openRemoteSheet', () => {
  let onFailed: ReturnType<typeof vi.fn<() => void>>;
  let stopListening: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.showMain.mockClear();
    mocks.request.mockClear();
    mocks.abort.mockClear();
    onFailed = vi.fn<() => void>();
    stopListening = listenRemoteSheetHost(onFailed);
  });

  afterEach(() => {
    stopListening();
    resetRemoteSheetForTests();
    vi.useRealTimers();
  });

  const requestIdOf = () =>
    (mocks.request.mock.calls[0] as unknown as [{ requestId: string }])[0]
      .requestId;

  it('메인을 앞으로 가져온 뒤 요청을 보내고, 닫힘이 오면 잠금을 풀며 결과를 돌려준다', async () => {
    const promise = openRemoteSheet({ kind: 'webFont', editingId: null });
    expect(isRemoteSheetActive()).toBe(true);
    await flush();
    expect(mocks.showMain).toHaveBeenCalledTimes(1);
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'webFont', editingId: null }),
    );
    // showMain이 먼저, 요청이 나중
    expect(mocks.showMain.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.request.mock.invocationCallOrder[0],
    );

    const requestId = requestIdOf();
    mocks.accepted?.({ requestId });
    // 다른 요청의 닫힘은 무시한다
    mocks.closed?.({ requestId: 'other', status: 'saved', kind: 'webFont' });
    expect(isRemoteSheetActive()).toBe(true);

    mocks.closed?.({ requestId, status: 'saved', kind: 'webFont' });
    await expect(promise).resolves.toEqual({
      requestId,
      status: 'saved',
      kind: 'webFont',
    });
    expect(useRemoteSheetStore.getState().active).toBeNull();
    expect(onFailed).not.toHaveBeenCalled();
  });

  it('메인이 수락하지 않으면 시간 안에 실패로 풀고 알리며, 늦게 뜬 시트를 내리라고 중단을 보낸다', async () => {
    const promise = openRemoteSheet({ kind: 'webFont', editingId: 'f1' });
    await flush();
    vi.advanceTimersByTime(3000);
    await expect(promise).resolves.toMatchObject({ status: 'failed' });
    expect(isRemoteSheetActive()).toBe(false);
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(mocks.abort).toHaveBeenCalledWith(requestIdOf());
  });

  it('타임아웃 뒤 전송 거부가 겹쳐도 알림은 한 번이다', async () => {
    let rejectRequest: (error: Error) => void = () => {};
    mocks.request.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectRequest = reject;
        }),
    );
    const promise = openRemoteSheet({ kind: 'webFont', editingId: null });
    await flush();
    vi.advanceTimersByTime(3000);
    await expect(promise).resolves.toMatchObject({ status: 'failed' });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    rejectRequest(new Error('late reject'));
    await flush();
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(mocks.abort).toHaveBeenCalledTimes(1);
  });

  it('수락된 뒤에는 시간이 지나도 기다린다', async () => {
    const promise = openRemoteSheet({ kind: 'webFont', editingId: null });
    await flush();
    const requestId = requestIdOf();
    mocks.accepted?.({ requestId });
    vi.advanceTimersByTime(60_000);
    expect(isRemoteSheetActive()).toBe(true);
    mocks.closed?.({ requestId, status: 'cancelled' });
    await expect(promise).resolves.toMatchObject({ status: 'cancelled' });
  });

  it('호스트가 새로 뜨면 기다리던 요청을 취소로 정리한다', async () => {
    const promise = openRemoteSheet({ kind: 'webFont', editingId: null });
    await flush();
    mocks.accepted?.({ requestId: requestIdOf() });
    mocks.hostReady?.();
    await expect(promise).resolves.toMatchObject({ status: 'cancelled' });
    expect(isRemoteSheetActive()).toBe(false);
    expect(onFailed).not.toHaveBeenCalled();
  });

  it('하나가 떠 있는 동안 새 요청은 곧바로 취소된다', async () => {
    void openRemoteSheet({ kind: 'webFont', editingId: null });
    await flush();
    await expect(
      openRemoteSheet({ kind: 'soundTrim', mode: 'create' }),
    ).resolves.toMatchObject({ status: 'cancelled' });
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it('메인을 앞으로 가져오는 사이 타임아웃이 걸리면 요청을 내보내지 않는다', async () => {
    // showMain이 수락 시간창보다 오래 걸린다(트레이·최소화 복원)
    let releaseShowMain: () => void = () => {};
    mocks.showMain.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseShowMain = resolve;
        }),
    );
    const promise = openRemoteSheet({ kind: 'webFont', editingId: null });
    await flush();
    vi.advanceTimersByTime(3000);
    await expect(promise).resolves.toMatchObject({ status: 'failed' });
    expect(isRemoteSheetActive()).toBe(false);

    releaseShowMain();
    await flush();
    // 잠금이 이미 풀렸으므로 메인에 시트를 띄우면 두 창이 동시에 편집을 받는다
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('showMain이 실패해도 요청은 보낸다 - 수락 여부는 타임아웃이 판정한다', async () => {
    mocks.showMain.mockRejectedValueOnce(new Error('no main'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const promise = openRemoteSheet({ kind: 'webFont', editingId: null });
    await flush();
    expect(mocks.request).toHaveBeenCalledTimes(1);
    const requestId = requestIdOf();
    mocks.accepted?.({ requestId });
    mocks.closed?.({ requestId, status: 'cancelled' });
    await expect(promise).resolves.toMatchObject({ status: 'cancelled' });
    expect(onFailed).not.toHaveBeenCalled();
  });

  it('요청 전송이 실패하면 실패로 풀고 알린다', async () => {
    mocks.request.mockRejectedValueOnce(new Error('no window'));
    const promise = openRemoteSheet({ kind: 'webFont', editingId: null });
    await flush();
    await expect(promise).resolves.toMatchObject({ status: 'failed' });
    expect(onFailed).toHaveBeenCalledTimes(1);
  });
});
