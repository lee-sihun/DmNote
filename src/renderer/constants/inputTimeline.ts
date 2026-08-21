// source watermark 기본 cadence와 같은 한 구간을 프레젠테이션 여유로 둔다.
// 정확성은 watermark 상한이 보장하며 이 값은 정상 구간의 잦은 정지만 줄인다.
export const INPUT_TIMELINE_TRANSPORT_RESERVE_MS = 16;

export const nominalTimelineDelayMs = (
  thresholdMs: number,
  transportReserveMs = INPUT_TIMELINE_TRANSPORT_RESERVE_MS,
): number => Math.max(0, thresholdMs) + Math.max(0, transportReserveMs);

export const recommendedKeyDisplayDelayMs = ({
  travelMs,
  delayedNoteEnabled,
  thresholdMs,
  transportReserveMs = INPUT_TIMELINE_TRANSPORT_RESERVE_MS,
}: {
  travelMs: number;
  delayedNoteEnabled: boolean;
  thresholdMs: number;
  transportReserveMs?: number;
}): number =>
  Math.round(
    Math.max(0, travelMs) +
      (delayedNoteEnabled
        ? nominalTimelineDelayMs(thresholdMs, transportReserveMs)
        : 0),
  );
