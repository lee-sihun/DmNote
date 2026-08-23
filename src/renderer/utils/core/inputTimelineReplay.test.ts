import { describe, expect, it, vi } from 'vitest';
import type { CanonicalInputTimelineBatch } from '@src/types/inputTimeline';
import {
  InputTimelineReplay,
  type InputTimelineReplayCallbacks,
} from './inputTimelineReplay';

const baseline = {
  mode: '4key',
  activeKeys: [] as string[],
  counters: {},
  counterSessionId: 'counter-session',
  counterRevision: '0',
};

const batch = (
  revision: number,
  safeThroughUs: number,
  actions: CanonicalInputTimelineBatch['actions'],
): CanonicalInputTimelineBatch => ({
  version: 1,
  streamId: 'stream-a',
  revision: String(revision),
  sourceRevision: String(revision * 10),
  safeThroughUs: String(safeThroughUs),
  ...(revision === 1 ? { baseline } : {}),
  actions,
});

const callbacks = (): InputTimelineReplayCallbacks => ({
  onEpochReset: vi.fn(),
  onPressStart: vi.fn(),
  onPressResolve: vi.fn(),
  onKeyState: vi.fn(),
  onCounter: vi.fn(),
  onAdvance: vi.fn(),
  isPresentationIdle: vi.fn(() => false),
  onFailure: vi.fn(),
  onDiagnostics: vi.fn(),
});

describe('InputTimelineReplay', () => {
  it('starts a short press only after its threshold window is safe', () => {
    const sink = callbacks();
    const replay = new InputTimelineReplay(
      {
        enabled: true,
        thresholdMs: 100,
        presentationBufferMs: 0,
        keyDisplayDelayMs: 0,
        epochKey: 'test',
      },
      sink,
    );
    replay.ingest(
      batch(1, 200_000, [
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
      ]),
      1000,
    );

    replay.tick(1000);

    expect(sink.onPressStart).toHaveBeenCalledWith(
      expect.objectContaining({ downTimeMs: 100, upTimeMs: 150 }),
    );
    expect(sink.onPressResolve).toHaveBeenCalledWith(
      expect.objectContaining({ downTimeMs: 100, upTimeMs: 150 }),
    );
  });

  it('resolves a long press before the playhead reaches its up time', () => {
    const sink = callbacks();
    const replay = new InputTimelineReplay(
      {
        enabled: true,
        thresholdMs: 100,
        presentationBufferMs: 0,
        keyDisplayDelayMs: 0,
        epochKey: 'test',
      },
      sink,
    );
    replay.ingest(
      batch(1, 200_000, [
        {
          kind: 'state',
          pressId: 'press-a',
          mode: '4key',
          key: 'A',
          state: 'DOWN',
          eventTimeUs: '100000',
        },
      ]),
      1000,
    );
    replay.tick(1000);
    expect(replay.readPlayhead(1000)).toBe(100);

    replay.ingest(
      batch(2, 400_000, [
        {
          kind: 'state',
          pressId: 'press-a',
          mode: '4key',
          key: 'A',
          state: 'UP',
          eventTimeUs: '300000',
        },
      ]),
      1010,
    );

    expect(sink.onPressResolve).toHaveBeenCalledWith(
      expect.objectContaining({ upTimeMs: 300 }),
    );
    expect(replay.readPlayhead(1010)).toBe(100);
  });

  it('pauses on a gap and resumes from contiguous replay batches', () => {
    const sink = callbacks();
    const replay = new InputTimelineReplay(
      {
        enabled: true,
        thresholdMs: 100,
        presentationBufferMs: 0,
        keyDisplayDelayMs: 0,
        epochKey: 'test',
      },
      sink,
    );
    replay.ingest(batch(1, 200_000, []), 1000);
    replay.ingest(batch(3, 300_000, []), 1010);

    expect(replay.tick(1020)).toBeNull();
    expect(sink.onEpochReset).not.toHaveBeenCalledWith('validation_failure');
    expect(sink.onFailure).toHaveBeenCalledOnce();

    expect(
      replay.recover([batch(2, 250_000, []), batch(3, 300_000, [])], 1020),
    ).toBe(true);
    expect(replay.tick(1020)).not.toBeNull();
    expect(replay.recoveryCursor()).toEqual({
      streamId: 'stream-a',
      revision: '3',
    });
  });

  it('replays key and counter actions on the shared presentation target', () => {
    const sink = callbacks();
    const replay = new InputTimelineReplay(
      {
        enabled: true,
        thresholdMs: 100,
        presentationBufferMs: 20,
        keyDisplayDelayMs: 120,
        epochKey: 'test',
      },
      sink,
    );
    replay.ingest(
      batch(1, 200_000, [
        {
          kind: 'state',
          pressId: 'press-a',
          mode: '4key',
          key: 'A',
          state: 'DOWN',
          eventTimeUs: '100000',
        },
        {
          kind: 'counter',
          mode: '4key',
          key: 'A',
          count: 7,
          counterSessionId: 'counter-session',
          counterRevision: '1',
          eventTimeUs: '100000',
        },
      ]),
      1000,
    );

    replay.tick(1000);
    expect(sink.onKeyState).not.toHaveBeenCalled();
    expect(sink.onCounter).not.toHaveBeenCalled();

    replay.ingest(batch(2, 400_000, []), 1010);
    replay.tick(1020);
    expect(sink.onKeyState).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'A', state: 'DOWN' }),
    );
    expect(sink.onCounter).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'A', count: 7 }),
    );
  });

  it('recovers a failed OBS stream from a validated checkpoint', () => {
    const sink = callbacks();
    const replay = new InputTimelineReplay(
      {
        enabled: true,
        thresholdMs: 100,
        presentationBufferMs: 0,
        keyDisplayDelayMs: 0,
        epochKey: 'test',
      },
      sink,
    );
    replay.ingest(batch(1, 200_000, []), 1000);
    replay.ingest(batch(3, 300_000, []), 1010);
    replay.rebase(
      {
        version: 1,
        streamId: 'stream-a',
        revision: '3',
        sourceRevision: '30',
        safeThroughUs: '300000',
        baseline,
        activePresses: [],
      },
      1020,
    );

    expect(replay.tick(1020)).not.toBeNull();
    expect(sink.onEpochReset).toHaveBeenLastCalledWith('stream', baseline);
    expect(sink.onDiagnostics).toHaveBeenLastCalledWith(
      expect.objectContaining({ rebaseCount: 1 }),
    );
  });

  it('continues a press that is active in a checkpoint', () => {
    const sink = callbacks();
    const replay = new InputTimelineReplay(
      {
        enabled: true,
        thresholdMs: 100,
        presentationBufferMs: 0,
        keyDisplayDelayMs: 0,
        epochKey: 'test',
      },
      sink,
    );
    replay.rebase(
      {
        version: 1,
        streamId: 'stream-a',
        revision: '20',
        sourceRevision: '200',
        safeThroughUs: '300000',
        baseline: { ...baseline, activeKeys: ['A'] },
        activePresses: [
          {
            pressId: 'press-a',
            mode: '4key',
            key: 'A',
            downTimeUs: '100000',
          },
        ],
      },
      1000,
    );
    replay.ingest(
      batch(21, 400_000, [
        {
          kind: 'state',
          pressId: 'press-a',
          mode: '4key',
          key: 'A',
          state: 'UP',
          eventTimeUs: '350000',
        },
      ]),
      1010,
    );
    replay.tick(1010);

    expect(sink.onPressStart).toHaveBeenCalledWith(
      expect.objectContaining({ pressId: 'press-a', downTimeMs: 100 }),
    );
    expect(sink.onPressResolve).toHaveBeenCalledWith(
      expect.objectContaining({ pressId: 'press-a', upTimeMs: 350 }),
    );
  });

  it('restores a completed press observed while a checkpoint was in flight', () => {
    const sink = callbacks();
    const replay = new InputTimelineReplay(
      {
        enabled: true,
        thresholdMs: 100,
        presentationBufferMs: 0,
        keyDisplayDelayMs: 0,
        epochKey: 'test',
      },
      sink,
    );
    const observed = batch(20, 300_000, [
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
    ]);
    delete observed.baseline;

    replay.rebase(
      {
        version: 1,
        streamId: 'stream-a',
        revision: '20',
        sourceRevision: '200',
        safeThroughUs: '300000',
        baseline,
        activePresses: [],
      },
      1000,
      [observed],
    );
    replay.tick(1000);

    expect(sink.onPressStart).toHaveBeenCalledWith(
      expect.objectContaining({ pressId: 'press-a', downTimeMs: 100 }),
    );
    expect(sink.onPressResolve).toHaveBeenCalledWith(
      expect.objectContaining({ pressId: 'press-a', upTimeMs: 150 }),
    );
  });

  it('fails closed when the bounded presentation queue is exceeded', () => {
    const sink = callbacks();
    const replay = new InputTimelineReplay(
      {
        enabled: true,
        thresholdMs: 100,
        presentationBufferMs: 0,
        keyDisplayDelayMs: 10_000,
        epochKey: 'test',
      },
      sink,
    );
    const actions = Array.from({ length: 8193 }, (_, index) => ({
      kind: 'counter' as const,
      mode: '4key',
      key: `K${index}`,
      count: 1,
      counterSessionId: 'counter-session',
      counterRevision: String(index + 1),
      eventTimeUs: '100000',
    }));

    replay.ingest(batch(1, 200_000, actions), 1000);

    expect(sink.onFailure).toHaveBeenCalledWith(
      'Timeline presentation buffer exceeded bounds',
    );
    expect(replay.tick(1010)).toBeNull();
    expect(sink.onDiagnostics).toHaveBeenLastCalledWith(
      expect.objectContaining({ failureCount: 1, pendingActions: 0 }),
    );
  });

  it('recovers delay debt only after the presentation becomes idle', () => {
    let idle = false;
    const sink = callbacks();
    sink.isPresentationIdle = () => idle;
    const replay = new InputTimelineReplay(
      {
        enabled: true,
        thresholdMs: 100,
        presentationBufferMs: 100,
        keyDisplayDelayMs: 0,
        epochKey: 'test',
      },
      sink,
    );
    replay.ingest(batch(1, 500_000, []), 1000);
    expect(replay.tick(1000)?.playheadMs).toBe(300);

    replay.ingest(batch(2, 1_000_000, []), 2000);
    expect(replay.tick(2000)).toMatchObject({
      playheadMs: 300,
      delayDebtMs: 500,
    });

    idle = true;
    expect(replay.tick(2010)).toMatchObject({
      playheadMs: 810,
      delayDebtMs: 0,
    });
  });
});
