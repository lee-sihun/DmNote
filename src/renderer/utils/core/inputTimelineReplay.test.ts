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
  onFailure: vi.fn(),
});

describe('InputTimelineReplay', () => {
  it('starts a short press only after its threshold window is safe', () => {
    const sink = callbacks();
    const replay = new InputTimelineReplay(
      {
        enabled: true,
        thresholdMs: 100,
        transportReserveMs: 0,
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
        transportReserveMs: 0,
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

  it('fails closed until a new stream arrives', () => {
    const sink = callbacks();
    const replay = new InputTimelineReplay(
      {
        enabled: true,
        thresholdMs: 100,
        transportReserveMs: 0,
        keyDisplayDelayMs: 0,
        epochKey: 'test',
      },
      sink,
    );
    replay.ingest(batch(1, 200_000, []), 1000);
    replay.ingest(batch(3, 300_000, []), 1010);

    expect(replay.tick(1020)).toBeNull();
    expect(sink.onEpochReset).toHaveBeenCalledWith('validation_failure');
    expect(sink.onFailure).toHaveBeenCalledOnce();
  });

  it('replays key and counter actions on the shared presentation target', () => {
    const sink = callbacks();
    const replay = new InputTimelineReplay(
      {
        enabled: true,
        thresholdMs: 100,
        transportReserveMs: 20,
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
});
