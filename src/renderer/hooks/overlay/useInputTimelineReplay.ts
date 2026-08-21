import { useEffect, useRef } from 'react';
import { subscribe } from '@api/modules/shared';
import { animationScheduler } from '@utils/animation/animationScheduler';
import type {
  CanonicalInputTimelineBaseline,
  CanonicalInputTimelineBatch,
  CanonicalInputTimelineCounterAction,
  CanonicalInputTimelineStateAction,
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
  onKeyState: (action: CanonicalInputTimelineStateAction) => void;
  onCounter: (action: CanonicalInputTimelineCounterAction) => void;
  onAdvance: (playheadMs: number) => void;
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
  keyDisplayDelayMs,
  epochKey,
}: UseInputTimelineReplayOptions): PresentationTimeSource => {
  const handlersRef = useRef<InputTimelineReplayHandlers>({
    onEpochReset,
    onPressStart,
    onPressResolve,
    onKeyState,
    onCounter,
    onAdvance,
  });
  handlersRef.current = {
    onEpochReset,
    onPressStart,
    onPressResolve,
    onKeyState,
    onCounter,
    onAdvance,
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
      onFailure: (reason) =>
        console.error('[InputTimeline] replay stopped:', reason),
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
