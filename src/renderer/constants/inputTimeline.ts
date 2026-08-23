// 사용자 단노트 구분 시간과 별도로 적용하는 비저장 화면 재생 버퍼
export const INPUT_TIMELINE_PRESENTATION_BUFFER_MS = 80;

export const nominalTimelineDelayMs = (
  thresholdMs: number,
  presentationBufferMs = INPUT_TIMELINE_PRESENTATION_BUFFER_MS,
): number => Math.max(0, thresholdMs) + Math.max(0, presentationBufferMs);

export const recommendedKeyDisplayDelayMs = ({
  travelMs,
  delayedNoteEnabled,
  thresholdMs,
  presentationBufferMs = INPUT_TIMELINE_PRESENTATION_BUFFER_MS,
}: {
  travelMs: number;
  delayedNoteEnabled: boolean;
  thresholdMs: number;
  presentationBufferMs?: number;
}): number =>
  Math.round(
    Math.max(0, travelMs) +
      (delayedNoteEnabled
        ? nominalTimelineDelayMs(thresholdMs, presentationBufferMs)
        : 0),
  );
