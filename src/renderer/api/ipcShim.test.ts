import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 프로토콜 버전 스큐 경계: 서버가 PROTOCOL_MISMATCH를 보내면
// 구 페이지처럼 조용한 재접속 루프에 빠지지 않고 즉시 종단되어야 함
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.onclose?.();
  }
}

describe('ipcShim 프로토콜 불일치 처리', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    FakeWebSocket.instances = [];
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('PROTOCOL_MISMATCH는 재접속 없이 즉시 종단 오류로 거부한다', async () => {
    const { initIpcShim } = await import('./ipcShim');

    const promise = initIpcShim('ws://127.0.0.1:34891', 'token');
    const socket = FakeWebSocket.instances[0];
    expect(socket).toBeDefined();

    socket.onopen?.();
    socket.onmessage?.({
      data: JSON.stringify({
        v: 3,
        type: 'error',
        seq: 0,
        ts: 0,
        payload: {
          code: 'PROTOCOL_MISMATCH',
          message: 'Unsupported protocol version',
        },
      }),
    });

    await expect(promise).rejects.toThrow('protocol mismatch');

    // 서버가 연결을 닫아도 재접속 타이머가 생성되지 않아야 함
    socket.onclose?.();
    vi.advanceTimersByTime(10_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('AUTH_FAILED도 동일하게 종단 처리를 유지한다', async () => {
    const { initIpcShim } = await import('./ipcShim');

    const promise = initIpcShim('ws://127.0.0.1:34891', 'bad-token');
    const socket = FakeWebSocket.instances[0];

    socket.onopen?.();
    socket.onmessage?.({
      data: JSON.stringify({
        v: 3,
        type: 'error',
        seq: 0,
        ts: 0,
        payload: { code: 'AUTH_FAILED', message: 'Invalid token' },
      }),
    });

    await expect(promise).rejects.toThrow('auth failed');

    socket.onclose?.();
    vi.advanceTimersByTime(10_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('timeline gap은 checkpoint rebase 후 다음 revision부터 이어 붙인다', async () => {
    const { initIpcShim } = await import('./ipcShim');
    const promise = initIpcShim('ws://127.0.0.1:34891', 'token');
    const socket = FakeWebSocket.instances[0];
    socket.onopen?.();
    socket.onmessage?.({
      data: JSON.stringify({
        v: 3,
        type: 'hello_ack',
        seq: 0,
        ts: 0,
        payload: { serverVersion: 'test', obsMode: true, allowedList: [] },
      }),
    });
    socket.onmessage?.({
      data: JSON.stringify({
        v: 3,
        type: 'snapshot',
        seq: 1,
        ts: 0,
        payload: {},
      }),
    });
    await promise;

    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (
            command: string,
            args: Record<string, unknown>,
          ) => Promise<unknown>;
          transformCallback: (callback: (data: unknown) => void) => number;
        };
      }
    ).__TAURI_INTERNALS__;
    const onRebase = vi.fn();
    const onTimeline = vi.fn();
    await internals.invoke('plugin:event|listen', {
      event: 'keys:timeline-rebase',
      handler: internals.transformCallback(onRebase),
    });
    await internals.invoke('plugin:event|listen', {
      event: 'keys:timeline',
      handler: internals.transformCallback(onTimeline),
    });

    const liveBatch = {
      version: 1,
      streamId: 'stream-a',
      revision: '3',
      sourceRevision: '30',
      safeThroughUs: '30000',
      actions: [],
    };
    socket.onmessage?.({
      data: JSON.stringify({
        v: 3,
        type: 'tauri_event',
        seq: 2,
        ts: 0,
        payload: { event: 'keys:timeline', data: liveBatch },
      }),
    });
    expect(onTimeline).not.toHaveBeenCalled();
    expect(
      socket.sent.map((message) => JSON.parse(message)).at(-1),
    ).toMatchObject({
      type: 'timeline_replay_request',
      payload: { streamId: 'stream-a', afterRevision: '0' },
    });

    const checkpoint = {
      version: 1,
      streamId: 'stream-a',
      revision: '3',
      sourceRevision: '30',
      safeThroughUs: '30000',
      baseline: {
        mode: '4key',
        activeKeys: [],
        counters: {},
        counterSessionId: 'counter-a',
        counterRevision: '0',
      },
      activePresses: [],
    };
    socket.onmessage?.({
      data: JSON.stringify({
        v: 3,
        type: 'timeline_rebase',
        seq: 3,
        ts: 0,
        payload: checkpoint,
      }),
    });
    expect(onRebase).toHaveBeenCalledWith(
      expect.objectContaining({ payload: checkpoint }),
    );

    socket.onmessage?.({
      data: JSON.stringify({
        v: 3,
        type: 'tauri_event',
        seq: 4,
        ts: 0,
        payload: {
          event: 'keys:timeline',
          data: { ...liveBatch, revision: '4', sourceRevision: '40' },
        },
      }),
    });
    expect(onTimeline).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ revision: '4' }),
      }),
    );
  });
});
