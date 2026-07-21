import { describe, expect, it, vi } from 'vitest';

const { subscribe } = vi.hoisted(() => ({
  subscribe: vi.fn(),
}));

vi.mock('@utils/core/rawKeyEventBus', () => ({
  rawKeyEventBus: { subscribe },
}));

import { keysApi } from './keysApi';

describe('keysApi raw input subscription', () => {
  it('cleans up a subscription that resolves after the caller unsubscribes', async () => {
    let resolveSubscription!: (unsubscribe: () => void) => void;
    const rawUnsubscribe = vi.fn();
    subscribe.mockReturnValueOnce(
      new Promise<() => void>((resolve) => {
        resolveSubscription = resolve;
      }),
    );

    const unsubscribe = keysApi.onRawInput(vi.fn());
    unsubscribe();
    resolveSubscription(rawUnsubscribe);
    await vi.waitFor(() => expect(rawUnsubscribe).toHaveBeenCalledOnce());

    unsubscribe();
    expect(rawUnsubscribe).toHaveBeenCalledOnce();
  });
});
