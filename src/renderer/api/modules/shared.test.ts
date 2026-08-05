import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke, listen } = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(() => Promise.resolve(vi.fn())),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen }));

import { subscribe } from './shared';

describe('subscribe', () => {
  beforeEach(() => {
    listen.mockReset();
    listen.mockResolvedValue(vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('이벤트 구독 등록 실패를 이벤트 이름과 함께 기록한다', async () => {
    const error = new Error('registration failed');
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    listen.mockRejectedValueOnce(error);

    const unsubscribe = subscribe('keys:state', vi.fn());

    await expect(unsubscribe.ready).rejects.toBe(error);
    expect(consoleError).toHaveBeenCalledWith(
      '[API] Failed to subscribe to event "keys:state":',
      error,
    );
  });

  it('이벤트 구독 해제 실패를 이벤트 이름과 함께 기록한다', async () => {
    const error = new Error('unlisten failed');
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const unlisten = vi.fn(() => {
      throw error;
    });
    listen.mockResolvedValueOnce(unlisten);
    const unsubscribe = subscribe('keys:state', vi.fn());
    await unsubscribe.ready;

    unsubscribe();

    await vi.waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        '[API] Failed to unsubscribe from event "keys:state":',
        error,
      );
    });
  });
});
