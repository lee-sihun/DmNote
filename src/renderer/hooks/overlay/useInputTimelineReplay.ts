import { useEffect, useRef } from 'react';
import { subscribe } from '@api/modules/shared';
import { getInputTimelineCheckpoint } from '@api/modules/keysApi';
import { animationScheduler } from '@utils/animation/animationScheduler';
import { requestObsTimelineResync } from '@api/ipcShim';
import type {
  CanonicalInputTimelineBaseline,
  CanonicalInputTimelineBatch,
  CanonicalInputTimelineCounterAction,
  CanonicalInputTimelineRebase,
  CanonicalInputTimelineStateAction,
} from '@src/types/inputTimeline';
import {
  InputTimelineReplay,
  type TimelineEpochResetReason,
  type TimelinePress,
} from '@utils/core/inputTimelineReplay';
import { updateInputTimelineDiagnostics } from '@utils/core/inputTimelineDiagnostics';

const MAX_PENDING_LOCAL_TIMELINE_BATCHES = 1024;

export interface PresentationTimeSource {
  read(localFallbackMs: number): number;
  isEnabled(): boolean;
}

interface InputTimelineReplayHandlers {
  onEpochReset: (
    reason: TimelineEpochResetReason,
    baseline?: CanonicalInputTimelineBaseline,
  ) => void;
  onPressStart: (press: TimelinePress) => void;
  onPressResolve: (press: Required<TimelinePress>) => void;
  onKeyState: (action: CanonicalInputTimelineStateAction) => void;
  onCounter: (action: CanonicalInputTimelineCounterAction) => void;
  onAdvance: (playheadMs: number) => void;
  isPresentationIdle: () => boolean;
}

interface UseInputTimelineReplayOptions extends InputTimelineReplayHandlers {
  enabled: boolean;
  thresholdMs: number;
  transportReserveMs?: number;
  keyDisplayDelayMs: number;
  epochKey: string;
}

export const useInputTimelineReplay = ({
  enabled,
  thresholdMs,
  transportReserveMs = 0,
  onEpochReset,
  onPressStart,
  onPressResolve,
  onKeyState,
  onCounter,
  onAdvance,
  isPresentationIdle,
  keyDisplayDelayMs,
  epochKey,
}: UseInputTimelineReplayOptions): PresentationTimeSource => {
  const requestLocalRecoveryRef = useRef<() => void>(() => {});
  const handlersRef = useRef<InputTimelineReplayHandlers>({
    onEpochReset,
    onPressStart,
    onPressResolve,
    onKeyState,
    onCounter,
    onAdvance,
    isPresentationIdle,
  });
  handlersRef.current = {
    onEpochReset,
    onPressStart,
    onPressResolve,
    onKeyState,
    onCounter,
    onAdvance,
    isPresentationIdle,
  };

  const replayRef = useRef<InputTimelineReplay | null>(null);
  replayRef.current ??= new InputTimelineReplay(
    {
      enabled,
      thresholdMs,
      transportReserveMs,
      keyDisplayDelayMs,
      epochKey,
    },
    {
      onEpochReset: (reason, baseline) =>
        handlersRef.current.onEpochReset(reason, baseline),
      onPressStart: (press) => handlersRef.current.onPressStart(press),
      onPressResolve: (press) => handlersRef.current.onPressResolve(press),
      onKeyState: (action) => handlersRef.current.onKeyState(action),
      onCounter: (action) => handlersRef.current.onCounter(action),
      onAdvance: ({ playheadMs }) => handlersRef.current.onAdvance(playheadMs),
      isPresentationIdle: () => handlersRef.current.isPresentationIdle(),
      onFailure: (reason) => {
        console.error('[InputTimeline] replay stopped:', reason);
        if (window.__dmn_runtime === 'obs') {
          requestObsTimelineResync();
        } else {
          requestLocalRecoveryRef.current();
        }
      },
      onDiagnostics: updateInputTimelineDiagnostics,
    },
  );

  useEffect(() => {
    replayRef.current!.configure(
      {
        enabled,
        thresholdMs,
        transportReserveMs,
        keyDisplayDelayMs,
        epochKey,
      },
      performance.now(),
    );
  }, [enabled, thresholdMs, transportReserveMs, keyDisplayDelayMs, epochKey]);

  useEffect(() => {
    const isObs = window.__dmn_runtime === 'obs';
    let disposed = false;
    let recovering = !isObs;
    let recoveryInFlight = false;
    const pending = new Map<string, CanonicalInputTimelineBatch>();

    const revisionOf = (
      value: CanonicalInputTimelineBatch | CanonicalInputTimelineRebase,
    ): bigint | null => {
      if (!/^(?:0|[1-9]\d*)$/.test(value.revision)) return null;
      try {
        return BigInt(value.revision);
      } catch {
        return null;
      }
    };
    const queue = (batch: CanonicalInputTimelineBatch) => {
      pending.set(`${batch.streamId}\u0000${batch.revision}`, batch);
      if (pending.size <= MAX_PENDING_LOCAL_TIMELINE_BATCHES) return;
      console.warn(
        '[InputTimeline] local recovery queue exceeded bounds; checkpoint replaces queued batches',
      );
      pending.clear();
    };
    const recover = async () => {
      if (isObs || disposed || recoveryInFlight) return;
      recoveryInFlight = true;
      let checkpointApplied = false;
      try {
        const checkpoint = await getInputTimelineCheckpoint();
        if (disposed || !checkpoint) return;
        const checkpointRevision = revisionOf(checkpoint);
        if (checkpointRevision == null) return;

        if (!replayRef.current!.rebase(checkpoint, performance.now())) return;
        checkpointApplied = true;
        const queued = [...pending.values()]
          .filter((batch) => {
            const revision = revisionOf(batch);
            return (
              batch.streamId === checkpoint.streamId &&
              revision != null &&
              revision > checkpointRevision
            );
          })
          .sort((left, right) => {
            const leftRevision = revisionOf(left)!;
            const rightRevision = revisionOf(right)!;
            return leftRevision === rightRevision
              ? 0
              : leftRevision < rightRevision
              ? -1
              : 1;
          });
        pending.clear();
        recovering = false;
        for (let index = 0; index < queued.length; index += 1) {
          const batch = queued[index];
          replayRef.current!.ingest(batch, performance.now());
          if (!recovering) continue;
          for (let rest = index; rest < queued.length; rest += 1) {
            queue(queued[rest]);
          }
          break;
        }
      } catch (error) {
        if (!disposed) {
          console.error('[InputTimeline] local checkpoint failed:', error);
        }
      } finally {
        recoveryInFlight = false;
        if (!disposed && checkpointApplied && recovering) {
          void recover();
        }
      }
    };
    const beginLocalRecovery = () => {
      if (isObs || disposed) return;
      recovering = true;
      void recover();
    };
    requestLocalRecoveryRef.current = beginLocalRecovery;

    const unsubscribeRebase = subscribe<CanonicalInputTimelineRebase>(
      'keys:timeline-rebase',
      (checkpoint) => {
        replayRef.current!.rebase(checkpoint, performance.now());
      },
    );
    const unsubscribeTimeline = subscribe<CanonicalInputTimelineBatch>(
      'keys:timeline',
      (batch) => {
        if (recovering) {
          queue(batch);
          void recover();
          return;
        }
        replayRef.current!.ingest(batch, performance.now());
        if (recovering) queue(batch);
      },
    );
    if (!isObs) {
      void Promise.all([
        unsubscribeRebase.ready,
        unsubscribeTimeline.ready,
      ]).then(beginLocalRecovery);
    }
    return () => {
      disposed = true;
      pending.clear();
      requestLocalRecoveryRef.current = () => {};
      unsubscribeTimeline();
      unsubscribeRebase();
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const tick = (localNowMs: number) => {
      replayRef.current!.tick(localNowMs);
    };
    animationScheduler.add(tick);
    return () => animationScheduler.remove(tick);
  }, [enabled]);

  const sourceRef = useRef<PresentationTimeSource | null>(null);
  sourceRef.current ??= {
    read: (localFallbackMs) => replayRef.current!.readPlayhead(localFallbackMs),
    isEnabled: () => replayRef.current!.isEnabled(),
  };
  return sourceRef.current;
};
