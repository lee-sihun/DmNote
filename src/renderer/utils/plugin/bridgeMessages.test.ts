import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sendTo } = vi.hoisted(() => ({
  sendTo: vi.fn(),
}));

vi.mock('@api/modules/bridgeApi', () => ({ bridgeApi: { sendTo } }));

import { sendBridgeMessageBestEffort } from './bridgeMessages';

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('sendBridgeMessageBestEffort', () => {
  const originalApi = window.api;
  beforeEach(() => {
    sendTo.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.api = originalApi;
  });

  it('sends an internal bridge message', async () => {
    sendTo.mockResolvedValue(undefined);

    sendBridgeMessageBestEffort('overlay', 'test:sync', { value: 1 });
    await flushPromises();

    expect(sendTo).toHaveBeenCalledWith('overlay', 'test:sync', { value: 1 });
    expect(console.error).not.toHaveBeenCalled();
  });

  it('ignores an absent optional target window', async () => {
    sendTo.mockRejectedValue("Window 'overlay' not found");

    sendBridgeMessageBestEffort('overlay', 'test:sync');
    await flushPromises();

    expect(console.error).not.toHaveBeenCalled();
  });

  it('reports other asynchronous bridge failures', async () => {
    const error = new Error('bridge unavailable');
    sendTo.mockRejectedValue(error);

    sendBridgeMessageBestEffort('main', 'test:sync');
    await flushPromises();

    expect(console.error).toHaveBeenCalledWith(
      "[Bridge] Failed to send 'test:sync' to 'main':",
      error,
    );
  });

  it('reports synchronous bridge failures', () => {
    const error = new Error('serialization failed');
    sendTo.mockImplementation(() => {
      throw error;
    });

    expect(() =>
      sendBridgeMessageBestEffort('overlay', 'test:sync'),
    ).not.toThrow();
    expect(console.error).toHaveBeenCalledWith(
      "[Bridge] Failed to send 'test:sync' to 'overlay':",
      error,
    );
  });
});
