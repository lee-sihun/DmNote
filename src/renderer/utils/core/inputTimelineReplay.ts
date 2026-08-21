import type {
  CanonicalInputTimelineBaseline,
  CanonicalInputTimelineBatch,
  CanonicalInputTimelineCounterAction,
  CanonicalInputTimelineStateAction,
} from '@src/types/inputTimeline';
import { InputTimelineBuffer } from './inputTimeline';
import {
  PresentationClock,
  type PresentationClockSnapshot,
} from './presentationClock';

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
  onFailure: (reason: string) => void;
}

export interface InputTimelineReplayConfig {
  enabled: boolean;
  thresholdMs: number;
  transportReserveMs: number;
  keyDisplayDelayMs: number;
  epochKey: string;
}

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

  constructor(
    config: InputTimelineReplayConfig,
    callbacks: InputTimelineReplayCallbacks,
  ) {
    this.config = this.normalizeConfig(config);
    this.callbacks = callbacks;
    this.clock = new PresentationClock(
      this.config.thresholdMs,
      this.config.transportReserveMs,
    );
  }

  configure(config: InputTimelineReplayConfig, localNowMs: number): void {
    const next = this.normalizeConfig(config);
    if (
      next.enabled === this.config.enabled &&
      next.thresholdMs === this.config.thresholdMs &&
      next.transportReserveMs === this.config.transportReserveMs &&
      next.keyDisplayDelayMs === this.config.keyDisplayDelayMs &&
      next.epochKey === this.config.epochKey
    ) {
      return;
    }

    const wasEnabled = this.config.enabled;
    this.config = next;
    this.clearPendingPresses();
    this.clock.resetEpoch(next.thresholdMs, next.transportReserveMs);
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
        this.failed = true;
        this.clearPendingPresses();
        this.currentPlayheadMs = null;
        if (this.config.enabled) {
          this.callbacks.onEpochReset('validation_failure');
        }
        this.callbacks.onFailure(reason);
      }
      return;
    }

    if (result.type === 'new_stream') {
      this.failed = false;
      this.clearPendingPresses();
      this.clock.resetEpoch(
        this.config.thresholdMs,
        this.config.transportReserveMs,
      );
      this.currentPlayheadMs = null;
      if (this.config.enabled) {
        this.callbacks.onEpochReset('stream', result.baseline);
      }
    } else if (this.failed) {
      return;
    }

    const snapshot = this.buffer.snapshot();
    this.clock.updateWatermark(snapshot.safeThroughUs, receivedAtMs);
    if (!this.config.enabled) return;

    for (const action of result.actions) {
      if (action.kind === 'state') {
        this.ingestStateAction(action);
      }
      this.schedulePresentationAction(action);
    }
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
    return snapshot;
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
      this.config.thresholdMs + this.config.transportReserveMs;
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
      transportReserveMs: Math.max(0, Number(config.transportReserveMs) || 0),
      keyDisplayDelayMs: Math.max(0, Number(config.keyDisplayDelayMs) || 0),
      epochKey: String(config.epochKey ?? ''),
    };
  }
}
