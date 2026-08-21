import { useEffect, useRef } from 'react';
import { subscribe } from '@api/modules/shared';
import type { CanonicalInputTimelineBatch } from '@src/types/inputTimeline';
import type { NoteSettings } from '@src/types/settings/noteSettings';
import { InputTimelineBuffer } from '@utils/core/inputTimeline';
import { PresentationClock } from '@utils/core/presentationClock';

/**
 * 신규 입력 timeline 계약을 실제 transport에서 검증하는 shadow consumer.
 * 화면 상태는 변경하지 않으며 gap/불변식 위반만 fail-closed로 기록한다.
 */
export const useInputTimelineShadow = (
  noteSettings: NoteSettings | null,
): void => {
  const thresholdMs = Math.max(
    0,
    Number(noteSettings?.shortNoteThresholdMs ?? 0),
  );
  const thresholdRef = useRef(thresholdMs);
  const clockRef = useRef(new PresentationClock(thresholdMs));

  useEffect(() => {
    if (thresholdRef.current === thresholdMs) return;
    thresholdRef.current = thresholdMs;
    // 설정 변경은 향후 fade/clear presentation epoch 경계로 승격한다.
    clockRef.current.resetEpoch(thresholdMs);
  }, [thresholdMs]);

  useEffect(() => {
    const buffer = new InputTimelineBuffer();
    let failed = false;
    const unsubscribe = subscribe<CanonicalInputTimelineBatch>(
      'keys:timeline',
      (batch) => {
        const result = buffer.ingest(batch);
        if (result.type === 'stale') return;
        if (result.type === 'gap' || result.type === 'invalid') {
          if (!failed) {
            failed = true;
            console.error(
              '[InputTimeline][Shadow] stream validation failed',
              result,
            );
          }
          return;
        }

        if (result.type === 'new_stream') {
          failed = false;
          clockRef.current.resetEpoch(thresholdRef.current);
        }
        const snapshot = buffer.snapshot();
        try {
          const now = performance.now();
          clockRef.current.updateWatermark(snapshot.safeThroughUs, now);
          clockRef.current.tick(now);
        } catch (error) {
          if (!failed) {
            failed = true;
            console.error(
              '[InputTimeline][Shadow] clock validation failed',
              error,
            );
          }
        }
      },
    );

    return unsubscribe;
  }, []);
};
