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
        v: 2,
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
        v: 2,
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
});
