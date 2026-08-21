import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CanonicalInputTimelineBatch,
  CanonicalInputTimelineRebase,
} from '@src/types/inputTimeline';
import { useInputTimelineReplay } from './useInputTimelineReplay';

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (payload: unknown) => void>(),
  getCheckpoint: vi.fn(),
  animationTick: null as ((now: number) => void) | null,
  diagnostics: vi.fn(),
}));

vi.mock('@api/modules/shared', () => ({
  subscribe: (event: string, listener: (payload: unknown) => void) => {
    mocks.listeners.set(event, listener);
    const unsubscribe = vi.fn(() => mocks.listeners.delete(event));
    return Object.assign(unsubscribe, { ready: Promise.resolve() });
  },
}));

vi.mock('@api/modules/keysApi', () => ({
  getInputTimelineCheckpoint: mocks.getCheckpoint,
}));

vi.mock('@api/ipcShim', () => ({
  requestObsTimelineResync: vi.fn(),
}));

vi.mock('@utils/animation/animationScheduler', () => ({
  animationScheduler: {
    add: (callback: (now: number) => void) => {
      mocks.animationTick = callback;
    },
    remove: () => {
      mocks.animationTick = null;
    },
  },
}));

vi.mock('@utils/core/inputTimelineDiagnostics', () => ({
  updateInputTimelineDiagnostics: mocks.diagnostics,
}));

const checkpoint: CanonicalInputTimelineRebase = {
  version: 1,
  streamId: 'stream-a',
  revision: '20',
  sourceRevision: '200',
  safeThroughUs: '200000',
  baseline: {
    mode: '4key',
    activeKeys: [],
    counters: {},
    counterSessionId: 'counter-session',
    counterRevision: '0',
  },
  activePresses: [],
};

const nextBatch: CanonicalInputTimelineBatch = {
  version: 1,
  streamId: 'stream-a',
  revision: '21',
  sourceRevision: '210',
  safeThroughUs: '216000',
  actions: [],
};

const Harness = () => {
  useInputTimelineReplay({
    enabled: true,
    thresholdMs: 100,
    transportReserveMs: 16,
    keyDisplayDelayMs: 0,
    epochKey: 'test',
    onEpochReset: vi.fn(),
    onPressStart: vi.fn(),
    onPressResolve: vi.fn(),
    onKeyState: vi.fn(),
    onCounter: vi.fn(),
    onAdvance: vi.fn(),
    isPresentationIdle: () => false,
  });
  return null;
};

describe('useInputTimelineReplay local recovery', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.listeners.clear();
    mocks.getCheckpoint.mockReset();
    mocks.diagnostics.mockReset();
    mocks.animationTick = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('queues live batches until the initial native checkpoint is applied', async () => {
    let resolveCheckpoint!: (value: CanonicalInputTimelineRebase) => void;
    mocks.getCheckpoint.mockReturnValue(
      new Promise<CanonicalInputTimelineRebase>((resolve) => {
        resolveCheckpoint = resolve;
      }),
    );

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });
    expect(mocks.getCheckpoint).toHaveBeenCalledOnce();

    act(() => {
      mocks.listeners.get('keys:timeline')!(nextBatch);
    });
    await act(async () => {
      resolveCheckpoint(checkpoint);
      await Promise.resolve();
    });
    act(() => mocks.animationTick!(1000));

    expect(mocks.diagnostics).toHaveBeenLastCalledWith(
      expect.objectContaining({ streamId: 'stream-a', revision: '21' }),
    );
  });

  it('hard-rebases a native revision gap instead of remaining failed', async () => {
    const laterCheckpoint: CanonicalInputTimelineRebase = {
      ...checkpoint,
      revision: '22',
      sourceRevision: '220',
      safeThroughUs: '232000',
    };
    mocks.getCheckpoint
      .mockResolvedValueOnce(checkpoint)
      .mockResolvedValueOnce(laterCheckpoint);

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      mocks.listeners.get('keys:timeline')!({
        ...nextBatch,
        revision: '22',
        sourceRevision: '220',
        safeThroughUs: '232000',
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => mocks.animationTick!(1000));

    expect(mocks.getCheckpoint).toHaveBeenCalledTimes(2);
    expect(mocks.diagnostics).toHaveBeenLastCalledWith(
      expect.objectContaining({
        streamId: 'stream-a',
        revision: '22',
        failureCount: 1,
        rebaseCount: 2,
      }),
    );
  });
});
