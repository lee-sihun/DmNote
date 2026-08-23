import { describe, expect, it } from 'vitest';
import type {
  CanonicalInputTimelineBatch,
  CanonicalInputTimelineRebase,
} from '@src/types/inputTimeline';
import { InputTimelineBuffer } from './inputTimeline';

const batch = (
  revision: number,
  safeThroughUs: number,
  streamId = 'stream-a',
): CanonicalInputTimelineBatch => ({
  version: 1,
  streamId,
  revision: String(revision),
  sourceRevision: String(revision * 10),
  safeThroughUs: String(safeThroughUs),
  ...(revision === 1 && {
    baseline: {
      mode: '4key',
      activeKeys: [],
      counters: {},
      counterSessionId: 'counter-session',
      counterRevision: '0',
    },
  }),
  actions: [],
});

describe('InputTimelineBuffer', () => {
  it('accepts contiguous batches and rejects a transport gap', () => {
    const buffer = new InputTimelineBuffer();
    expect(buffer.ingest(batch(1, 1000)).type).toBe('new_stream');
    expect(buffer.ingest(batch(2, 2000)).type).toBe('accepted');
    expect(buffer.ingest(batch(4, 4000))).toEqual({
      type: 'gap',
      expectedRevision: '3',
      receivedRevision: '4',
    });
    expect(buffer.snapshot().gap).toBe(true);
  });

  it('requires a new stream to recover from a gap', () => {
    const buffer = new InputTimelineBuffer();
    buffer.ingest(batch(1, 1000));
    buffer.ingest(batch(3, 3000));
    expect(buffer.ingest(batch(2, 2000)).type).toBe('gap');
    expect(buffer.ingest(batch(4, 4000)).type).toBe('gap');
    expect(buffer.ingest(batch(1, 50, 'stream-b')).type).toBe('new_stream');
    expect(buffer.snapshot().gap).toBe(false);
  });

  it('resumes a gap only from the exact next replay revision', () => {
    const buffer = new InputTimelineBuffer();
    buffer.ingest(batch(1, 1000));
    buffer.ingest(batch(3, 3000));

    expect(buffer.resume(batch(3, 3000))).toEqual({
      type: 'gap',
      expectedRevision: '2',
      receivedRevision: '3',
    });
    expect(buffer.resume(batch(2, 2000)).type).toBe('accepted');
    expect(buffer.ingest(batch(3, 3000)).type).toBe('accepted');
    expect(buffer.snapshot()).toMatchObject({ revision: 3n, gap: false });
  });

  it('rejects an action beyond the watermark', () => {
    const buffer = new InputTimelineBuffer();
    const value = batch(1, 1000);
    value.actions.push({
      kind: 'state',
      pressId: 'press-a',
      mode: '4key',
      key: 'A',
      state: 'DOWN',
      eventTimeUs: '1001',
    });
    expect(buffer.ingest(value)).toEqual({
      type: 'invalid',
      reason: 'Timeline action exceeds safeThroughUs',
    });
  });

  it('requires a baseline on the first batch only', () => {
    const missing = batch(1, 1000);
    delete missing.baseline;
    const buffer = new InputTimelineBuffer();
    expect(buffer.ingest(missing)).toEqual({
      type: 'invalid',
      reason: 'New timeline stream lacks baseline',
    });

    const nextBuffer = new InputTimelineBuffer();
    nextBuffer.ingest(batch(1, 1000));
    const unexpected = batch(2, 2000);
    unexpected.baseline = batch(1, 1000).baseline;
    expect(nextBuffer.ingest(unexpected)).toEqual({
      type: 'invalid',
      reason: 'Timeline baseline appeared after stream start',
    });
  });

  it('validates press lifecycle across batch boundaries', () => {
    const buffer = new InputTimelineBuffer();
    const down = batch(1, 1000);
    down.actions.push({
      kind: 'state',
      pressId: 'press-a',
      mode: '4key',
      key: 'A',
      state: 'DOWN',
      eventTimeUs: '500',
    });
    expect(buffer.ingest(down).type).toBe('new_stream');

    const up = batch(2, 2000);
    up.actions.push({
      kind: 'state',
      pressId: 'press-a',
      mode: '4key',
      key: 'A',
      state: 'UP',
      eventTimeUs: '1500',
    });
    expect(buffer.ingest(up).type).toBe('accepted');
  });

  it('fails closed on a duplicate canonical down', () => {
    const buffer = new InputTimelineBuffer();
    const down = batch(1, 1000);
    down.actions.push({
      kind: 'state',
      pressId: 'press-a',
      mode: '4key',
      key: 'A',
      state: 'DOWN',
      eventTimeUs: '500',
    });
    buffer.ingest(down);

    const duplicate = batch(2, 2000);
    duplicate.actions.push({
      kind: 'state',
      pressId: 'press-b',
      mode: '4key',
      key: 'A',
      state: 'DOWN',
      eventTimeUs: '1500',
    });
    expect(buffer.ingest(duplicate)).toEqual({
      type: 'invalid',
      reason: 'Duplicate timeline DOWN',
    });
    expect(buffer.snapshot().gap).toBe(true);
  });

  it('accepts an OBS checkpoint and continues the active press lifecycle', () => {
    const buffer = new InputTimelineBuffer();
    const checkpoint: CanonicalInputTimelineRebase = {
      version: 1,
      streamId: 'stream-a',
      revision: '20',
      sourceRevision: '200',
      safeThroughUs: '20000',
      baseline: {
        mode: '4key',
        activeKeys: ['A'],
        counters: { '4key': { A: 3 } },
        counterSessionId: 'counter-session',
        counterRevision: '3',
      },
      activePresses: [
        {
          pressId: 'press-a',
          mode: '4key',
          key: 'A',
          downTimeUs: '15000',
        },
      ],
    };

    expect(buffer.rebase(checkpoint).type).toBe('new_stream');
    const up = batch(21, 21_000);
    up.sourceRevision = '210';
    up.actions.push({
      kind: 'state',
      pressId: 'press-a',
      mode: '4key',
      key: 'A',
      state: 'UP',
      eventTimeUs: '20500',
    });
    expect(buffer.ingest(up).type).toBe('accepted');
  });

  it('rejects a checkpoint whose active key snapshot cannot continue safely', () => {
    const buffer = new InputTimelineBuffer();
    const checkpoint: CanonicalInputTimelineRebase = {
      version: 1,
      streamId: 'stream-a',
      revision: '20',
      sourceRevision: '200',
      safeThroughUs: '20000',
      baseline: {
        mode: '4key',
        activeKeys: [],
        counters: {},
        counterSessionId: 'counter-session',
        counterRevision: '0',
      },
      activePresses: [
        {
          pressId: 'press-a',
          mode: '4key',
          key: 'A',
          downTimeUs: '15000',
        },
      ],
    };

    expect(buffer.rebase(checkpoint)).toEqual({
      type: 'invalid',
      reason: 'Timeline rebase active keys do not match presses',
    });
  });

  it('continues an unknown baseline press without inventing its DOWN time', () => {
    const buffer = new InputTimelineBuffer();
    const checkpoint: CanonicalInputTimelineRebase = {
      version: 1,
      streamId: 'stream-a',
      revision: '20',
      sourceRevision: '200',
      safeThroughUs: '20000',
      baseline: {
        mode: '4key',
        activeKeys: ['A'],
        counters: {},
        counterSessionId: 'counter-session',
        counterRevision: '0',
      },
      activePresses: [],
    };

    expect(buffer.rebase(checkpoint).type).toBe('new_stream');
    const up = batch(21, 21_000);
    up.sourceRevision = '210';
    up.actions.push({
      kind: 'state',
      pressId: 'stream-a/0/A',
      mode: '4key',
      key: 'A',
      state: 'UP',
      eventTimeUs: '20500',
    });
    expect(buffer.ingest(up).type).toBe('accepted');
  });
});
