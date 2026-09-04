import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalBootstrapPayload } from '@src/types/app';

const mocks = vi.hoisted(() => ({
  applyCounterCacheSnapshot: vi.fn(),
  applyCounterSnapshot: vi.fn(),
  setCachedKeyCounter: vi.fn(),
  setKeyCounter: vi.fn(),
}));

vi.mock('@api/pluginDisplayElements', () => ({
  getUndoRedoInProgress: vi.fn(() => false),
}));
vi.mock('@stores/signals/keyCounterCache', () => ({
  applyCounterCacheSnapshot: mocks.applyCounterCacheSnapshot,
  setCachedKeyCounter: mocks.setCachedKeyCounter,
}));
vi.mock('@stores/signals/keyCounterSignals', () => ({
  applyCounterSnapshot: mocks.applyCounterSnapshot,
  setKeyCounter: mocks.setKeyCounter,
}));
vi.mock('@stores/data/useKeyStore', () => ({
  useKeyStore: {
    getState: () => ({ selectedKeyType: '4key' }),
  },
}));
vi.mock('@stores/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      noteSettings: { keyDisplayDelayMs: 30000 },
      tabNoteOverrides: {},
    }),
  },
}));

import { createAppCounterRuntime } from './appCounterRuntime';

describe('appCounterRuntime 재동기화 수명주기', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('in-flight load 중 dispose하면 snapshot·editor sync·지연 반영 없이 promise를 종료한다', async () => {
    let resolveBootstrap!: (bootstrap: CanonicalBootstrapPayload) => void;
    const bootstrapPromise = new Promise<CanonicalBootstrapPayload>(
      (resolve) => {
        resolveBootstrap = resolve;
      },
    );
    const loadBootstrap = vi.fn(() => bootstrapPromise);
    const applySnapshot = vi.fn();
    const syncEditor = vi.fn(async () => undefined);
    const runtime = createAppCounterRuntime(true);
    runtime.markInitialApplied();

    const resyncPromise = runtime.runResync({
      loadBootstrap,
      applySnapshot,
      syncEditor,
    });
    runtime.handleCounterChanged({
      mode: '4key',
      key: 'KeyK',
      count: 7,
      sessionId: 'session-a',
      revision: 1,
    });
    expect(vi.getTimerCount()).toBe(1);

    runtime.dispose();
    expect(vi.getTimerCount()).toBe(0);
    resolveBootstrap({} as CanonicalBootstrapPayload);

    await expect(resyncPromise).resolves.toBeUndefined();
    vi.runAllTimers();
    expect(applySnapshot).not.toHaveBeenCalled();
    expect(syncEditor).not.toHaveBeenCalled();
    expect(mocks.applyCounterSnapshot).not.toHaveBeenCalled();
    expect(mocks.setKeyCounter).not.toHaveBeenCalled();

    await runtime.runResync({ loadBootstrap, applySnapshot, syncEditor });
    expect(loadBootstrap).toHaveBeenCalledTimes(1);
  });

  it('초기 gate 전 queued resync를 gate 개방 뒤 한 번만 실행한다', async () => {
    const loadBootstrap = vi
      .fn<() => Promise<CanonicalBootstrapPayload>>()
      .mockResolvedValue({} as CanonicalBootstrapPayload);
    const applySnapshot = vi.fn();
    const syncEditor = vi.fn(async () => undefined);
    const runtime = createAppCounterRuntime(true);
    const options = { loadBootstrap, applySnapshot, syncEditor };

    await runtime.runResync(options);
    await runtime.runResync(options);
    await runtime.runResync(options);

    expect(loadBootstrap).not.toHaveBeenCalled();
    expect(runtime.markInitialApplied()).toBe(true);
    await runtime.runResync(options);

    expect(loadBootstrap).toHaveBeenCalledTimes(1);
    expect(applySnapshot).toHaveBeenCalledTimes(1);
    expect(syncEditor).toHaveBeenCalledTimes(1);
    runtime.dispose();
  });
});
