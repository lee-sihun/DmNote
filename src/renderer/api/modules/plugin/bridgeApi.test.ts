/**
 * 브릿지 수신 필터 - sendTo는 전역 발행에 target을 실어 보내므로 내 창이 아니면 무시한다
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listenMock = vi.hoisted(() => ({
  handler: null as null | ((event: { payload: unknown }) => void),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(
    (_event: string, handler: (event: { payload: unknown }) => void) => {
      listenMock.handler = handler;
      return Promise.resolve(() => {});
    },
  ),
}));

const globalWindow = window as unknown as { __dmn_window_type?: string };

describe('bridgeApi target 필터', () => {
  beforeEach(async () => {
    globalWindow.__dmn_window_type = 'main';
    vi.resetModules();
    await import('./bridgeApi');
  });

  afterEach(() => {
    delete globalWindow.__dmn_window_type;
  });

  const deliver = (payload: unknown) => listenMock.handler?.({ payload });

  it('다른 창을 향한 sendTo 메시지는 리스너를 부르지 않는다', async () => {
    const { bridgeApi } = await import('./bridgeApi');
    const listener = vi.fn();
    bridgeApi.on('PING', listener);

    deliver({ type: 'PING', data: 1, target: 'overlay' });
    expect(listener).not.toHaveBeenCalled();

    deliver({ type: 'PING', data: 2, target: 'main' });
    expect(listener).toHaveBeenCalledWith(2);
  });

  it('target 없는 브로드캐스트(send)는 그대로 받는다', async () => {
    const { bridgeApi } = await import('./bridgeApi');
    const listener = vi.fn();
    bridgeApi.on('PING', listener);

    deliver({ type: 'PING', data: 3 });
    expect(listener).toHaveBeenCalledWith(3);
  });
});
