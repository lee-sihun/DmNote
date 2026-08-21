import { useEffect, useMemo, useRef, useState } from 'react';
import type { NoteSettings } from '@src/types/settings/noteSettings';
import type { ContentFadeStyle } from './useTrackReserveTransition';

const FADE_OUT_MS = 80;
const FADE_GAP_MS = 20;
const FADE_IN_MS = 140;

const epochSignature = (
  settings: NoteSettings,
  noteEffect: boolean,
  mode: string,
): string =>
  JSON.stringify([
    mode,
    noteEffect,
    settings.delayedNoteEnabled,
    settings.shortNoteThresholdMs,
    settings.shortNoteMinLengthPx,
    settings.speed,
    settings.trackHeight,
    settings.reverse,
    settings.frameLimit,
    settings.keyDisplayDelayMs,
    settings.fadePosition,
    settings.fadeTopPx,
    settings.fadeBottomPx,
    settings.reverseFadeTopPx,
    settings.reverseFadeBottomPx,
  ]);

interface UseTimelineEpochTransitionOptions {
  target: NoteSettings;
  noteEffect: boolean;
  mode: string;
  hydrated: boolean;
}

interface TimelineEpochTransitionResult {
  settings: NoteSettings;
  epochKey: string;
  contentFade: ContentFadeStyle | null;
}

export const useTimelineEpochTransition = ({
  target,
  noteEffect,
  mode,
  hydrated,
}: UseTimelineEpochTransitionOptions): TimelineEpochTransitionResult => {
  const [applied, setApplied] = useState(target);
  const [appliedMode, setAppliedMode] = useState(mode);
  const [appliedNoteEffect, setAppliedNoteEffect] = useState(noteEffect);
  const [contentFade, setContentFade] = useState<ContentFadeStyle | null>(null);
  const runIdRef = useRef(0);

  const targetKey = epochSignature(target, noteEffect, mode);
  const appliedKey = epochSignature(applied, appliedNoteEffect, appliedMode);
  const adoptImmediately =
    targetKey !== appliedKey &&
    (!hydrated || (!target.delayedNoteEnabled && !applied.delayedNoteEnabled));
  if (adoptImmediately) {
    setApplied(target);
    setAppliedMode(mode);
    setAppliedNoteEffect(noteEffect);
  }

  useEffect(() => {
    const adopt = () => {
      setApplied(target);
      setAppliedMode(mode);
      setAppliedNoteEffect(noteEffect);
    };

    if (adoptImmediately || targetKey === appliedKey) {
      runIdRef.current += 1;
      return;
    }

    const runId = ++runIdRef.current;
    const isCurrent = () => runIdRef.current === runId;
    const fadeTimer = setTimeout(() => {
      if (isCurrent()) {
        setContentFade({ opacity: 0, durationMs: FADE_OUT_MS });
      }
    }, 0);
    const applyTimer = setTimeout(() => {
      if (!isCurrent()) return;
      adopt();
      setContentFade({ opacity: 1, durationMs: FADE_IN_MS });
    }, FADE_OUT_MS + FADE_GAP_MS);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(applyTimer);
    };
  }, [
    target,
    targetKey,
    applied,
    appliedKey,
    adoptImmediately,
    noteEffect,
    mode,
    hydrated,
  ]);

  useEffect(() => {
    if (!contentFade || contentFade.opacity !== 1) return;
    const timer = setTimeout(
      () => setContentFade(null),
      contentFade.durationMs + FADE_GAP_MS,
    );
    return () => clearTimeout(timer);
  }, [contentFade]);

  return useMemo(
    () => ({ settings: applied, epochKey: appliedKey, contentFade }),
    [applied, appliedKey, contentFade],
  );
};

export const mergeContentFades = (
  first: ContentFadeStyle | null,
  second: ContentFadeStyle | null,
): ContentFadeStyle | null => {
  if (!first) return second;
  if (!second) return first;
  return {
    opacity: Math.min(first.opacity, second.opacity),
    durationMs: Math.max(first.durationMs, second.durationMs),
  };
};
