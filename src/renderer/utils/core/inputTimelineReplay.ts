import type {
  CanonicalInputTimelineBaseline,
  CanonicalInputTimelineBatch,
  CanonicalInputTimelineCounterAction,
  CanonicalInputTimelineRebase,
  CanonicalInputTimelineStateAction,
} from '@src/types/inputTimeline';
import { InputTimelineBuffer } from './inputTimeline';
import type { InputTimelineIngestResult } from './inputTimeline';
import {
  PresentationClock,
  type PresentationClockSnapshot,
} from './presentationClock';
import type { InputTimelineDiagnostics } from './inputTimelineDiagnostics';

const MAX_PENDING_PRESSES = 4096;
const MAX_PENDING_ACTIONS = 8192;
const MAX_BUFFERED_SOURCE_SPAN_MS = 30_000;

export interface TimelinePress {
  pressId: string;
  mode: string;
  key: string;
  downTimeMs: number;
  upTimeMs?: number;
}

export type TimelineEpochResetReason =
  | 'stream'
  | 'configuration'
  | 'validation_failure';

export interface InputTimelineReplayCallbacks {
  onEpochReset: (
    reason: TimelineEpochResetReason,
    baseline?: CanonicalInputTimelineBaseline,
  ) => void;
  onPressStart: (press: TimelinePress) => void;
  onPressResolve: (press: Required<TimelinePress>) => void;
  onKeyState: (action: CanonicalInputTimelineStateAction) => void;
  onCounter: (action: CanonicalInputTimelineCounterAction) => void;
  onAdvance: (snapshot: PresentationClockSnapshot) => void;
  isPresentationIdle: () => boolean;
  onFailure: (reason: string) => void;
  onDiagnostics: (diagnostics: InputTimelineDiagnostics) => void;
}

export interface InputTimelineReplayConfig {
  enabled: boolean;
  thresholdMs: number;
  presentationBufferMs: number;
  keyDisplayDelayMs: number;
  epochKey: string;
}

export interface InputTimelineRecoveryCursor {
  streamId: string;
  revision: string;
}

type AcceptedTimelineResult = Extract<
  InputTimelineIngestResult,
  { type: 'new_stream' | 'accepted' }
>;

interface PendingPress extends TimelinePress {
  started: boolean;
}

type ScheduledPresentationAction = {
  targetTimeMs: number;
  action:
    | CanonicalInputTimelineStateAction
    | CanonicalInputTimelineCounterAction;
};

const sourceUsToMs = (value: string): number => {
  const converted = Number(BigInt(value)) / 1000;
  if (!Number.isFinite(converted)) {
    throw new Error(`Invalid source time: ${value}`);
  }
  return converted;
};

export class InputTimelineReplay {
  private readonly buffer = new InputTimelineBuffer();
  private readonly callbacks: InputTimelineReplayCallbacks;
  private readonly clock: PresentationClock;
  private config: InputTimelineReplayConfig;
  private presses = new Map<string, PendingPress>();
  private pendingStarts: PendingPress[] = [];
  private pendingStartIndex = 0;
  private scheduledActions: ScheduledPresentationAction[] = [];
  private scheduledActionIndex = 0;
  private failed = false;
  private currentPlayheadMs: number | null = null;
  private lastWatermarkReceivedAtMs: number | null = null;
  private maxWatermarkIntervalMs = 0;
  private rebaseCount = 0;
  private failureCount = 0;

  constructor(
    config: InputTimelineReplayConfig,
    callbacks: InputTimelineReplayCallbacks,
  ) {
    this.config = this.normalizeConfig(config);
    this.callbacks = callbacks;
    this.clock = new PresentationClock(
      this.config.thresholdMs,
      this.config.presentationBufferMs,
    );
  }

  configure(config: InputTimelineReplayConfig, localNowMs: number): void {
    const next = this.normalizeConfig(config);
    if (
      next.enabled === this.config.enabled &&
      next.thresholdMs === this.config.thresholdMs &&
      next.presentationBufferMs === this.config.presentationBufferMs &&
      next.keyDisplayDelayMs === this.config.keyDisplayDelayMs &&
      next.epochKey === this.config.epochKey
    ) {
      return;
    }

    const wasEnabled = this.config.enabled;
    this.config = next;
    this.clearPendingPresses();
    this.clock.resetEpoch(next.thresholdMs, next.presentationBufferMs);
    this.currentPlayheadMs = null;

    const snapshot = this.buffer.snapshot();
    if (!snapshot.gap && snapshot.streamId && snapshot.safeThroughUs > 0n) {
      this.clock.updateWatermark(snapshot.safeThroughUs, localNowMs);
    }
    if (wasEnabled || next.enabled) {
      this.callbacks.onEpochReset('configuration');
    }
  }

  ingest(batch: CanonicalInputTimelineBatch, receivedAtMs: number): void {
    const result = this.buffer.ingest(batch);
    if (result.type === 'stale') return;
    if (result.type === 'gap' || result.type === 'invalid') {
      if (!this.failed) {
        const reason =
          result.type === 'gap'
            ? `Timeline gap: expected ${result.expectedRevision}, received ${result.receivedRevision}`
            : result.reason;
        this.pauseForRecovery(reason);
      }
      return;
    }

    this.applyAcceptedResult(result, receivedAtMs);
  }

  recover(
    batches: CanonicalInputTimelineBatch[],
    receivedAtMs: number,
  ): boolean {
    if (batches.length === 0) return !this.failed;

    const first = this.buffer.resume(batches[0]);
    if (first.type !== 'new_stream' && first.type !== 'accepted') {
      return false;
    }
    this.failed = false;
    this.applyAcceptedResult(first, receivedAtMs);
    if (this.failed) return false;

    for (const batch of batches.slice(1)) {
      this.ingest(batch, receivedAtMs);
      if (this.failed) return false;
    }
    return true;
  }

  recoveryCursor(): InputTimelineRecoveryCursor | null {
    const snapshot = this.buffer.snapshot();
    if (!snapshot.streamId || snapshot.revision === 0n) return null;
    return {
      streamId: snapshot.streamId,
      revision: snapshot.revision.toString(),
    };
  }

  private applyAcceptedResult(
    result: AcceptedTimelineResult,
    receivedAtMs: number,
  ): void {
    if (result.type === 'new_stream') {
      this.failed = false;
      this.clearPendingPresses();
      this.clock.resetEpoch(
        this.config.thresholdMs,
        this.config.presentationBufferMs,
      );
      this.currentPlayheadMs = null;
      if (this.config.enabled) {
        this.callbacks.onEpochReset('stream', result.baseline);
      }
    } else if (this.failed) {
      return;
    }

    const snapshot = this.buffer.snapshot();
    this.observeWatermarkArrival(receivedAtMs);
    this.clock.updateWatermark(snapshot.safeThroughUs, receivedAtMs);
    if (!this.config.enabled) return;

    for (const action of result.actions) {
      if (action.kind === 'state') {
        this.ingestStateAction(action);
      }
      this.schedulePresentationAction(action);
    }
    if (this.exceedsBufferBounds(snapshot.safeThroughUs)) {
      this.failClosed('Timeline presentation buffer exceeded bounds');
    }
  }

  rebase(
    checkpoint: CanonicalInputTimelineRebase,
    receivedAtMs: number,
    observedBatches: CanonicalInputTimelineBatch[] = [],
  ): boolean {
    const result = this.buffer.rebase(checkpoint);
    if (result.type !== 'new_stream') {
      const reason =
        result.type === 'invalid'
          ? result.reason
          : 'Unexpected timeline rebase result';
      this.failClosed(reason);
      return false;
    }

    this.failed = false;
    this.rebaseCount += 1;
    this.clearPendingPresses();
    this.clock.resetEpoch(
      this.config.thresholdMs,
      this.config.presentationBufferMs,
    );
    this.clock.updateWatermark(BigInt(checkpoint.safeThroughUs), receivedAtMs);
    this.currentPlayheadMs = null;
    this.observeWatermarkArrival(receivedAtMs);
    this.restoreObservedPresses(checkpoint, observedBatches);
    if (this.presses.size > MAX_PENDING_PRESSES) {
      this.failClosed('Timeline checkpoint press buffer exceeded bounds');
      return false;
    }
    if (this.config.enabled) {
      this.callbacks.onEpochReset('stream', checkpoint.baseline);
    }
    return true;
  }

  tick(localNowMs: number): PresentationClockSnapshot | null {
    if (!this.config.enabled || this.failed) return null;
    const snapshot = this.clock.tick(localNowMs);
    if (!snapshot) return null;
    this.currentPlayheadMs = snapshot.playheadMs;

    while (this.scheduledActionIndex < this.scheduledActions.length) {
      const scheduled = this.scheduledActions[this.scheduledActionIndex];
      if (scheduled.targetTimeMs > snapshot.playheadMs) break;
      this.scheduledActionIndex += 1;
      if (scheduled.action.kind === 'state') {
        this.callbacks.onKeyState(scheduled.action);
      } else {
        this.callbacks.onCounter(scheduled.action);
      }
    }

    while (this.pendingStartIndex < this.pendingStarts.length) {
      const press = this.pendingStarts[this.pendingStartIndex];
      if (press.downTimeMs > snapshot.playheadMs) break;
      this.pendingStartIndex += 1;
      press.started = true;
      this.callbacks.onPressStart(press);
      if (press.upTimeMs != null) {
        this.callbacks.onPressResolve(press as Required<TimelinePress>);
        this.presses.delete(press.pressId);
      }
    }

    if (
      this.pendingStartIndex > 1024 &&
      this.pendingStartIndex * 2 > this.pendingStarts.length
    ) {
      this.pendingStarts = this.pendingStarts.slice(this.pendingStartIndex);
      this.pendingStartIndex = 0;
    }
    if (
      this.scheduledActionIndex > 1024 &&
      this.scheduledActionIndex * 2 > this.scheduledActions.length
    ) {
      this.scheduledActions = this.scheduledActions.slice(
        this.scheduledActionIndex,
      );
      this.scheduledActionIndex = 0;
    }
    this.callbacks.onAdvance(snapshot);
    const recovered = this.recoverDelayDebtIfIdle(localNowMs, snapshot);
    this.emitDiagnostics(recovered);
    return recovered;
  }

  readPlayhead(localFallbackMs: number): number {
    return this.config.enabled && this.currentPlayheadMs != null
      ? this.currentPlayheadMs
      : localFallbackMs;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  private ingestStateAction(action: CanonicalInputTimelineStateAction): void {
    const eventTimeMs = sourceUsToMs(action.eventTimeUs);
    if (action.state === 'DOWN') {
      const press: PendingPress = {
        pressId: action.pressId,
        mode: action.mode,
        key: action.key,
        downTimeMs: eventTimeMs,
        started: false,
      };
      this.presses.set(action.pressId, press);
      this.pendingStarts.push(press);
      return;
    }

    const press = this.presses.get(action.pressId);
    if (!press) return;
    press.upTimeMs = eventTimeMs;
    if (press.started) {
      this.callbacks.onPressResolve(press as Required<TimelinePress>);
      this.presses.delete(press.pressId);
    }
  }

  private restoreObservedPresses(
    checkpoint: CanonicalInputTimelineRebase,
    observedBatches: CanonicalInputTimelineBatch[],
  ): void {
    const checkpointRevision = BigInt(checkpoint.revision);
    const activeById = new Map(
      checkpoint.activePresses.map((press) => [press.pressId, press]),
    );
    const observed = new Map<string, PendingPress>();
    const batches = observedBatches
      .filter((batch) => {
        if (batch.streamId !== checkpoint.streamId) return false;
        try {
          return BigInt(batch.revision) <= checkpointRevision;
        } catch {
          return false;
        }
      })
      .sort((left, right) => {
        const leftRevision = BigInt(left.revision);
        const rightRevision = BigInt(right.revision);
        return leftRevision === rightRevision
          ? 0
          : leftRevision < rightRevision
          ? -1
          : 1;
      });

    for (const batch of batches) {
      for (const action of batch.actions) {
        if (action.kind !== 'state') continue;
        if (action.state === 'DOWN') {
          if (observed.has(action.pressId)) continue;
          observed.set(action.pressId, {
            pressId: action.pressId,
            mode: action.mode,
            key: action.key,
            downTimeMs: sourceUsToMs(action.eventTimeUs),
            started: false,
          });
          continue;
        }

        const press = observed.get(action.pressId);
        if (
          !press ||
          press.mode !== action.mode ||
          press.key !== action.key ||
          press.upTimeMs != null
        ) {
          continue;
        }
        const upTimeMs = sourceUsToMs(action.eventTimeUs);
        if (upTimeMs >= press.downTimeMs) {
          press.upTimeMs = upTimeMs;
        }
      }
    }

    for (const press of observed.values()) {
      const active = activeById.get(press.pressId);
      const remainsActive =
        active != null &&
        active.mode === press.mode &&
        active.key === press.key &&
        sourceUsToMs(active.downTimeUs) === press.downTimeMs;
      if (press.upTimeMs == null && !remainsActive) continue;
      this.presses.set(press.pressId, press);
      this.pendingStarts.push(press);
      activeById.delete(press.pressId);
    }

    for (const active of activeById.values()) {
      const press: PendingPress = {
        pressId: active.pressId,
        mode: active.mode,
        key: active.key,
        downTimeMs: sourceUsToMs(active.downTimeUs),
        started: false,
      };
      this.presses.set(press.pressId, press);
      this.pendingStarts.push(press);
    }
    this.pendingStarts.sort(
      (left, right) => left.downTimeMs - right.downTimeMs,
    );
  }

  private clearPendingPresses(): void {
    this.presses.clear();
    this.pendingStarts = [];
    this.pendingStartIndex = 0;
    this.scheduledActions = [];
    this.scheduledActionIndex = 0;
  }

  private schedulePresentationAction(
    action:
      | CanonicalInputTimelineStateAction
      | CanonicalInputTimelineCounterAction,
  ): void {
    const nominalDelayMs =
      this.config.thresholdMs + this.config.presentationBufferMs;
    this.scheduledActions.push({
      targetTimeMs:
        sourceUsToMs(action.eventTimeUs) +
        this.config.keyDisplayDelayMs -
        nominalDelayMs,
      action,
    });
  }

  private normalizeConfig(
    config: InputTimelineReplayConfig,
  ): InputTimelineReplayConfig {
    return {
      enabled: config.enabled,
      thresholdMs: Math.max(0, Number(config.thresholdMs) || 0),
      presentationBufferMs: Math.max(
        0,
        Number(config.presentationBufferMs) || 0,
      ),
      keyDisplayDelayMs: Math.max(0, Number(config.keyDisplayDelayMs) || 0),
      epochKey: String(config.epochKey ?? ''),
    };
  }

  private exceedsBufferBounds(safeThroughUs: bigint): boolean {
    const pendingActions =
      this.scheduledActions.length - this.scheduledActionIndex;
    const bufferedSpanMs =
      this.currentPlayheadMs == null
        ? 0
        : Number(safeThroughUs) / 1000 - this.currentPlayheadMs;
    return (
      this.presses.size > MAX_PENDING_PRESSES ||
      pendingActions > MAX_PENDING_ACTIONS ||
      bufferedSpanMs > MAX_BUFFERED_SOURCE_SPAN_MS
    );
  }

  private observeWatermarkArrival(receivedAtMs: number): void {
    if (this.lastWatermarkReceivedAtMs != null) {
      this.maxWatermarkIntervalMs = Math.max(
        this.maxWatermarkIntervalMs,
        Math.max(0, receivedAtMs - this.lastWatermarkReceivedAtMs),
      );
    }
    this.lastWatermarkReceivedAtMs = receivedAtMs;
  }

  private recoverDelayDebtIfIdle(
    localNowMs: number,
    snapshot: PresentationClockSnapshot,
  ): PresentationClockSnapshot {
    if (
      snapshot.delayDebtMs <= 0 ||
      this.presses.size > 0 ||
      this.pendingStartIndex < this.pendingStarts.length ||
      this.scheduledActionIndex < this.scheduledActions.length ||
      !this.callbacks.isPresentationIdle()
    ) {
      return snapshot;
    }
    const recovered = this.clock.recoverDelayDebt(localNowMs) ?? snapshot;
    this.currentPlayheadMs = recovered.playheadMs;
    if (recovered.playheadMs !== snapshot.playheadMs) {
      this.callbacks.onAdvance(recovered);
    }
    return recovered;
  }

  private failClosed(reason: string): void {
    this.failed = true;
    this.failureCount += 1;
    this.clearPendingPresses();
    this.currentPlayheadMs = null;
    if (this.config.enabled) {
      this.callbacks.onEpochReset('validation_failure');
    }
    this.callbacks.onFailure(reason);
    this.emitDiagnostics();
  }

  private pauseForRecovery(reason: string): void {
    this.failed = true;
    this.failureCount += 1;
    this.callbacks.onFailure(reason);
    this.emitDiagnostics();
  }

  private emitDiagnostics(clock?: PresentationClockSnapshot): void {
    const buffer = this.buffer.snapshot();
    this.callbacks.onDiagnostics({
      streamId: buffer.streamId,
      revision: buffer.revision.toString(),
      pendingPresses: this.presses.size,
      pendingActions: this.scheduledActions.length - this.scheduledActionIndex,
      safeHeadroomMs:
        clock == null ? 0 : Math.max(0, clock.safeTargetMs - clock.playheadMs),
      delayDebtMs: clock?.delayDebtMs ?? 0,
      stalled: clock?.stalled ?? false,
      maxWatermarkIntervalMs: this.maxWatermarkIntervalMs,
      rebaseCount: this.rebaseCount,
      failureCount: this.failureCount,
    });
  }
}
