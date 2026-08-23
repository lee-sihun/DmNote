import {
  CANONICAL_INPUT_TIMELINE_VERSION,
  type CanonicalInputTimelineRebase,
  type CanonicalInputTimelineAction,
  type CanonicalInputTimelineBaseline,
  type CanonicalInputTimelineBatch,
} from '@src/types/inputTimeline';

const DECIMAL_U64 = /^(?:0|[1-9]\d*)$/;
const U32_MAX = 0xffff_ffff;

const parseU64 = (value: string, field: string): bigint => {
  if (!DECIMAL_U64.test(value)) {
    throw new Error(`Invalid ${field}: ${value}`);
  }
  const parsed = BigInt(value);
  if (parsed > 0xffff_ffff_ffff_ffffn) {
    throw new Error(`${field} exceeds u64: ${value}`);
  }
  return parsed;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const baselinePressId = (streamId: string, key: string): string =>
  `${streamId}/0/${key}`;

const validateBaseline = (baseline: CanonicalInputTimelineBaseline): void => {
  if (
    !isRecord(baseline) ||
    typeof baseline.mode !== 'string' ||
    !Array.isArray(baseline.activeKeys) ||
    baseline.activeKeys.some((key) => typeof key !== 'string') ||
    typeof baseline.counterSessionId !== 'string' ||
    baseline.counterSessionId.length === 0 ||
    !isRecord(baseline.counters)
  ) {
    throw new Error('Invalid timeline baseline');
  }
  parseU64(baseline.counterRevision, 'baseline.counterRevision');
  for (const entries of Object.values(baseline.counters)) {
    if (!isRecord(entries)) throw new Error('Invalid timeline counters');
    for (const count of Object.values(entries)) {
      if (
        typeof count !== 'number' ||
        !Number.isInteger(count) ||
        count < 0 ||
        count > U32_MAX
      ) {
        throw new Error('Invalid timeline counter value');
      }
    }
  }
};

const validateAction = (action: CanonicalInputTimelineAction): bigint => {
  if (
    !isRecord(action) ||
    typeof action.mode !== 'string' ||
    typeof action.key !== 'string'
  ) {
    throw new Error('Invalid timeline action');
  }
  const eventTimeUs = parseU64(action.eventTimeUs, 'eventTimeUs');
  if (action.kind === 'state') {
    if (
      typeof action.pressId !== 'string' ||
      action.pressId.length === 0 ||
      (action.state !== 'DOWN' && action.state !== 'UP')
    ) {
      throw new Error('Invalid timeline state action');
    }
    return eventTimeUs;
  }
  if (action.kind === 'counter') {
    if (
      !Number.isInteger(action.count) ||
      action.count < 0 ||
      action.count > U32_MAX ||
      typeof action.counterSessionId !== 'string' ||
      action.counterSessionId.length === 0 ||
      parseU64(action.counterRevision, 'counterRevision') === 0n
    ) {
      throw new Error('Invalid timeline counter action');
    }
    return eventTimeUs;
  }
  throw new Error('Unknown timeline action kind');
};

export type InputTimelineIngestResult =
  | {
      type: 'new_stream';
      baseline: CanonicalInputTimelineBaseline;
      actions: CanonicalInputTimelineAction[];
    }
  | { type: 'accepted'; actions: CanonicalInputTimelineAction[] }
  | { type: 'stale' }
  | { type: 'gap'; expectedRevision: string; receivedRevision: string }
  | { type: 'invalid'; reason: string };

export interface InputTimelineSnapshot {
  streamId: string | null;
  revision: bigint;
  sourceRevision: bigint;
  safeThroughUs: bigint;
  gap: boolean;
}

export class InputTimelineBuffer {
  private streamId: string | null = null;
  private revision = 0n;
  private sourceRevision = 0n;
  private safeThroughUs = 0n;
  private gap = false;
  private activePresses = new Map<string, { mode: string; key: string }>();
  private activeKeys = new Map<string, string>();

  private validateStateLifecycle(
    actions: CanonicalInputTimelineAction[],
    reset: boolean,
    baseline?: {
      streamId: string;
      value: CanonicalInputTimelineBaseline;
    },
  ): {
    activePresses: Map<string, { mode: string; key: string }>;
    activeKeys: Map<string, string>;
  } {
    const activePresses = reset
      ? new Map<string, { mode: string; key: string }>()
      : new Map(this.activePresses);
    const activeKeys = reset
      ? new Map<string, string>()
      : new Map(this.activeKeys);

    if (baseline) {
      for (const key of baseline.value.activeKeys) {
        const composedKey = `${baseline.value.mode}\u0000${key}`;
        const pressId = baselinePressId(baseline.streamId, key);
        if (activeKeys.has(composedKey) || activePresses.has(pressId)) {
          throw new Error('Duplicate timeline baseline key');
        }
        activePresses.set(pressId, {
          mode: baseline.value.mode,
          key,
        });
        activeKeys.set(composedKey, pressId);
      }
    }

    for (const action of actions) {
      if (action.kind !== 'state') continue;
      const composedKey = `${action.mode}\u0000${action.key}`;
      if (action.state === 'DOWN') {
        if (activePresses.has(action.pressId) || activeKeys.has(composedKey)) {
          throw new Error('Duplicate timeline DOWN');
        }
        activePresses.set(action.pressId, {
          mode: action.mode,
          key: action.key,
        });
        activeKeys.set(composedKey, action.pressId);
        continue;
      }

      const active = activePresses.get(action.pressId);
      if (
        !active ||
        active.mode !== action.mode ||
        active.key !== action.key ||
        activeKeys.get(composedKey) !== action.pressId
      ) {
        throw new Error('Unmatched timeline UP');
      }
      activePresses.delete(action.pressId);
      activeKeys.delete(composedKey);
    }
    return { activePresses, activeKeys };
  }

  ingest(batch: CanonicalInputTimelineBatch): InputTimelineIngestResult {
    const invalid = (reason: string): InputTimelineIngestResult => {
      if (this.streamId != null && this.streamId === batch.streamId) {
        this.gap = true;
      }
      return { type: 'invalid', reason };
    };
    try {
      if (batch.version !== CANONICAL_INPUT_TIMELINE_VERSION) {
        return invalid(`Unsupported timeline version: ${batch.version}`);
      }
      if (!batch.streamId) {
        return invalid('Missing timeline streamId');
      }

      const revision = parseU64(batch.revision, 'revision');
      const sourceRevision = parseU64(batch.sourceRevision, 'sourceRevision');
      const safeThroughUs = parseU64(batch.safeThroughUs, 'safeThroughUs');
      if (revision === 0n || sourceRevision === 0n) {
        return invalid('Timeline revisions must be positive');
      }
      if (!Array.isArray(batch.actions)) {
        return invalid('Timeline actions must be an array');
      }
      let previousActionTimeUs: bigint | null = null;
      for (const action of batch.actions) {
        const eventTimeUs = validateAction(action);
        if (eventTimeUs > safeThroughUs) {
          return invalid('Timeline action exceeds safeThroughUs');
        }
        if (
          previousActionTimeUs != null &&
          eventTimeUs < previousActionTimeUs
        ) {
          return invalid('Timeline actions are not time ordered');
        }
        previousActionTimeUs = eventTimeUs;
      }

      if (this.streamId !== batch.streamId) {
        if (revision !== 1n) {
          this.streamId = batch.streamId;
          this.revision = revision;
          this.sourceRevision = sourceRevision;
          this.safeThroughUs = safeThroughUs;
          this.gap = true;
          this.activePresses.clear();
          this.activeKeys.clear();
          return {
            type: 'gap',
            expectedRevision: '1',
            receivedRevision: revision.toString(),
          };
        }
        if (!batch.baseline) {
          this.streamId = batch.streamId;
          this.gap = true;
          this.activePresses.clear();
          this.activeKeys.clear();
          return invalid('New timeline stream lacks baseline');
        }
        validateBaseline(batch.baseline);
        const lifecycle = this.validateStateLifecycle(batch.actions, true, {
          streamId: batch.streamId,
          value: batch.baseline,
        });
        this.streamId = batch.streamId;
        this.revision = revision;
        this.sourceRevision = sourceRevision;
        this.safeThroughUs = safeThroughUs;
        this.gap = false;
        this.activePresses = lifecycle.activePresses;
        this.activeKeys = lifecycle.activeKeys;
        return {
          type: 'new_stream',
          baseline: batch.baseline,
          actions: batch.actions,
        };
      }

      if (revision <= this.revision) {
        return { type: 'stale' };
      }
      const expectedRevision = this.revision + 1n;
      if (this.gap || revision !== expectedRevision) {
        this.gap = true;
        return {
          type: 'gap',
          expectedRevision: expectedRevision.toString(),
          receivedRevision: revision.toString(),
        };
      }
      if (
        sourceRevision <= this.sourceRevision ||
        safeThroughUs < this.safeThroughUs
      ) {
        this.gap = true;
        return invalid('Timeline source watermark moved backwards');
      }
      if (batch.baseline) {
        this.gap = true;
        return invalid('Timeline baseline appeared after stream start');
      }
      if (
        batch.actions.length > 0 &&
        parseU64(batch.actions[0].eventTimeUs, 'eventTimeUs') <=
          this.safeThroughUs
      ) {
        this.gap = true;
        return invalid('Timeline action appeared behind prior watermark');
      }
      const lifecycle = this.validateStateLifecycle(batch.actions, false);

      this.revision = revision;
      this.sourceRevision = sourceRevision;
      this.safeThroughUs = safeThroughUs;
      this.activePresses = lifecycle.activePresses;
      this.activeKeys = lifecycle.activeKeys;
      return { type: 'accepted', actions: batch.actions };
    } catch (error) {
      return invalid(error instanceof Error ? error.message : String(error));
    }
  }

  resume(batch: CanonicalInputTimelineBatch): InputTimelineIngestResult {
    if (!this.gap || this.streamId !== batch.streamId) {
      return this.ingest(batch);
    }

    try {
      const revision = parseU64(batch.revision, 'revision');
      const expectedRevision = this.revision + 1n;
      if (revision !== expectedRevision) {
        return {
          type: 'gap',
          expectedRevision: expectedRevision.toString(),
          receivedRevision: revision.toString(),
        };
      }
    } catch {
      return this.ingest(batch);
    }

    this.gap = false;
    const result = this.ingest(batch);
    if (
      result.type !== 'accepted' &&
      result.type !== 'new_stream' &&
      result.type !== 'stale'
    ) {
      this.gap = true;
    }
    return result;
  }

  rebase(checkpoint: CanonicalInputTimelineRebase): InputTimelineIngestResult {
    try {
      if (
        checkpoint.version !== CANONICAL_INPUT_TIMELINE_VERSION ||
        !checkpoint.streamId
      ) {
        throw new Error('Invalid timeline rebase envelope');
      }
      const revision = parseU64(checkpoint.revision, 'revision');
      const sourceRevision = parseU64(
        checkpoint.sourceRevision,
        'sourceRevision',
      );
      const safeThroughUs = parseU64(checkpoint.safeThroughUs, 'safeThroughUs');
      if (revision === 0n || sourceRevision === 0n) {
        throw new Error('Timeline rebase revisions must be positive');
      }
      validateBaseline(checkpoint.baseline);
      if (!Array.isArray(checkpoint.activePresses)) {
        throw new Error('Invalid timeline rebase active presses');
      }

      const activePresses = new Map<string, { mode: string; key: string }>();
      const activeKeys = new Map<string, string>();
      for (const press of checkpoint.activePresses) {
        if (
          !isRecord(press) ||
          typeof press.pressId !== 'string' ||
          !press.pressId ||
          typeof press.mode !== 'string' ||
          typeof press.key !== 'string' ||
          parseU64(press.downTimeUs, 'downTimeUs') > safeThroughUs
        ) {
          throw new Error('Invalid timeline rebase active press');
        }
        const composedKey = `${press.mode}\u0000${press.key}`;
        if (activePresses.has(press.pressId) || activeKeys.has(composedKey)) {
          throw new Error('Duplicate timeline rebase active press');
        }
        activePresses.set(press.pressId, {
          mode: press.mode,
          key: press.key,
        });
        activeKeys.set(composedKey, press.pressId);
      }

      const baselineKeys = new Set(checkpoint.baseline.activeKeys);
      if (baselineKeys.size !== checkpoint.baseline.activeKeys.length) {
        throw new Error('Duplicate timeline rebase baseline key');
      }
      if (
        checkpoint.activePresses.some(
          (press) =>
            press.mode === checkpoint.baseline.mode &&
            !baselineKeys.has(press.key),
        )
      ) {
        throw new Error('Timeline rebase active keys do not match presses');
      }
      for (const key of baselineKeys) {
        const composedKey = `${checkpoint.baseline.mode}\u0000${key}`;
        if (activeKeys.has(composedKey)) continue;
        const pressId = baselinePressId(checkpoint.streamId, key);
        if (activePresses.has(pressId)) {
          throw new Error('Duplicate timeline rebase active press');
        }
        activePresses.set(pressId, {
          mode: checkpoint.baseline.mode,
          key,
        });
        activeKeys.set(composedKey, pressId);
      }

      this.streamId = checkpoint.streamId;
      this.revision = revision;
      this.sourceRevision = sourceRevision;
      this.safeThroughUs = safeThroughUs;
      this.gap = false;
      this.activePresses = activePresses;
      this.activeKeys = activeKeys;
      return {
        type: 'new_stream',
        baseline: checkpoint.baseline,
        actions: [],
      };
    } catch (error) {
      this.gap = true;
      return {
        type: 'invalid',
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  snapshot(): InputTimelineSnapshot {
    return {
      streamId: this.streamId,
      revision: this.revision,
      sourceRevision: this.sourceRevision,
      safeThroughUs: this.safeThroughUs,
      gap: this.gap,
    };
  }
}
