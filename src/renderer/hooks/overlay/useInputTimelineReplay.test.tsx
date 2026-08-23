import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CanonicalInputTimelineBatch,
  CanonicalInputTimelineRebase,
} from '@src/types/inputTimeline';
import { INPUT_TIMELINE_PRESENTATION_BUFFER_MS } from '@constants/inputTimeline';
import { useInputTimelineReplay } from './useInputTimelineReplay';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (payload: unknown) => void>(),
  getCheckpoint: vi.fn(),
  recoverTimeline: vi.fn(),
  animationTick: null as ((now: number) => void) | null,
  diagnostics: vi.fn(),
  pressStart: vi.fn(),
  pressResolve: vi.fn(),
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
  recoverInputTimeline: mocks.recoverTimeline,
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
    presentationBufferMs: INPUT_TIMELINE_PRESENTATION_BUFFER_MS,
    keyDisplayDelayMs: 0,
    epochKey: 'test',
    onEpochReset: vi.fn(),
    onPressStart: mocks.pressStart,
    onPressResolve: mocks.pressResolve,
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
    mocks.recoverTimeline.mockReset();
    mocks.diagnostics.mockReset();
    mocks.pressStart.mockReset();
    mocks.pressResolve.mockReset();
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
    const now = performance.now();
    act(() => {
      mocks.animationTick!(now + 50);
      mocks.animationTick!(now + 100);
      mocks.animationTick!(now + 150);
      mocks.animationTick!(now + 200);
    });

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
    mocks.getCheckpoint.mockResolvedValueOnce(checkpoint);
    mocks.recoverTimeline.mockResolvedValueOnce({
      type: 'rebase',
      payload: laterCheckpoint,
    });

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

    expect(mocks.getCheckpoint).toHaveBeenCalledOnce();
    expect(mocks.recoverTimeline).toHaveBeenCalledWith('stream-a', '20');
    expect(mocks.diagnostics).toHaveBeenLastCalledWith(
      expect.objectContaining({
        streamId: 'stream-a',
        revision: '22',
        failureCount: 1,
        rebaseCount: 2,
      }),
    );
  });

  it('does not drop a completed press received during initial checkpoint loading', async () => {
    let resolveCheckpoint!: (value: CanonicalInputTimelineRebase) => void;
    mocks.getCheckpoint.mockReturnValue(
      new Promise<CanonicalInputTimelineRebase>((resolve) => {
        resolveCheckpoint = resolve;
      }),
    );
    const observedBatch: CanonicalInputTimelineBatch = {
      ...nextBatch,
      revision: '20',
      sourceRevision: '200',
      safeThroughUs: '300000',
      actions: [
        {
          kind: 'state',
          pressId: 'press-a',
          mode: '4key',
          key: 'A',
          state: 'DOWN',
          eventTimeUs: '100000',
        },
        {
          kind: 'state',
          pressId: 'press-a',
          mode: '4key',
          key: 'A',
          state: 'UP',
          eventTimeUs: '150000',
        },
      ],
    };

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });
    act(() => mocks.listeners.get('keys:timeline')!(observedBatch));
    await act(async () => {
      resolveCheckpoint({
        ...checkpoint,
        safeThroughUs: '300000',
      });
      await Promise.resolve();
    });
    act(() => mocks.animationTick!(1000));

    expect(mocks.pressStart).toHaveBeenCalledWith(
      expect.objectContaining({ pressId: 'press-a', downTimeMs: 100 }),
    );
    expect(mocks.pressResolve).toHaveBeenCalledWith(
      expect.objectContaining({ pressId: 'press-a', upTimeMs: 150 }),
    );
  });

  it('replays a completed press from a missing native revision', async () => {
    const missingBatch: CanonicalInputTimelineBatch = {
      ...nextBatch,
      revision: '21',
      sourceRevision: '210',
      safeThroughUs: '400000',
      actions: [
        {
          kind: 'state',
          pressId: 'press-gap',
          mode: '4key',
          key: 'A',
          state: 'DOWN',
          eventTimeUs: '201000',
        },
        {
          kind: 'state',
          pressId: 'press-gap',
          mode: '4key',
          key: 'A',
          state: 'UP',
          eventTimeUs: '220000',
        },
      ],
    };
    const receivedBatch: CanonicalInputTimelineBatch = {
      ...nextBatch,
      revision: '22',
      sourceRevision: '220',
      safeThroughUs: '416000',
    };
    mocks.getCheckpoint.mockResolvedValueOnce(checkpoint);
    mocks.recoverTimeline.mockResolvedValueOnce({
      type: 'replay',
      payload: {
        streamId: 'stream-a',
        afterRevision: '20',
        latestRevision: '22',
        batches: [missingBatch, receivedBatch],
      },
    });

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      mocks.listeners.get('keys:timeline')!(receivedBatch);
      await Promise.resolve();
      await Promise.resolve();
    });
    const replayNow = performance.now();
    act(() => {
      mocks.animationTick!(replayNow + 50);
      mocks.animationTick!(replayNow + 100);
      mocks.animationTick!(replayNow + 150);
      mocks.animationTick!(replayNow + 200);
    });

    expect(mocks.recoverTimeline).toHaveBeenCalledWith('stream-a', '20');
    expect(mocks.pressStart).toHaveBeenCalledWith(
      expect.objectContaining({ pressId: 'press-gap', downTimeMs: 201 }),
    );
    expect(mocks.pressResolve).toHaveBeenCalledWith(
      expect.objectContaining({ pressId: 'press-gap', upTimeMs: 220 }),
    );
  });
});
