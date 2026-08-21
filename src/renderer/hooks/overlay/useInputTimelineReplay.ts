import { useEffect, useRef } from 'react';
import { subscribe } from '@api/modules/shared';
import { animationScheduler } from '@utils/animation/animationScheduler';
import type {
  CanonicalInputTimelineBaseline,
  CanonicalInputTimelineBatch,
} from '@src/types/inputTimeline';
import {
  InputTimelineReplay,
  type TimelineEpochResetReason,
  type TimelinePress,
} from '@utils/core/inputTimelineReplay';

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
  onAdvance: (playheadMs: number) => void;
}

interface UseInputTimelineReplayOptions extends InputTimelineReplayHandlers {
  enabled: boolean;
  thresholdMs: number;
  transportReserveMs?: number;
}

export const useInputTimelineReplay = ({
  enabled,
  thresholdMs,
  transportReserveMs = 0,
  onEpochReset,
  onPressStart,
  onPressResolve,
  onAdvance,
}: UseInputTimelineReplayOptions): PresentationTimeSource => {
  const handlersRef = useRef<InputTimelineReplayHandlers>({
    onEpochReset,
    onPressStart,
    onPressResolve,
    onAdvance,
  });
  handlersRef.current = {
    onEpochReset,
    onPressStart,
    onPressResolve,
    onAdvance,
  };

  const replayRef = useRef<InputTimelineReplay | null>(null);
  replayRef.current ??= new InputTimelineReplay(
    { enabled, thresholdMs, transportReserveMs },
    {
      onEpochReset: (reason, baseline) =>
        handlersRef.current.onEpochReset(reason, baseline),
      onPressStart: (press) => handlersRef.current.onPressStart(press),
      onPressResolve: (press) => handlersRef.current.onPressResolve(press),
      onAdvance: ({ playheadMs }) => handlersRef.current.onAdvance(playheadMs),
      onFailure: (reason) =>
        console.error('[InputTimeline] replay stopped:', reason),
    },
  );

  useEffect(() => {
    replayRef.current!.configure(
      { enabled, thresholdMs, transportReserveMs },
      performance.now(),
    );
  }, [enabled, thresholdMs, transportReserveMs]);

  useEffect(
    () =>
      subscribe<CanonicalInputTimelineBatch>('keys:timeline', (batch) => {
        replayRef.current!.ingest(batch, performance.now());
      }),
    [],
  );

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
