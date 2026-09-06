// Rust state/editor.rs의 MAX_GESTURE_IDS와 동일한 IPC 상한
const MAX_PENDING_GESTURE_IDS = 32;

export const retainPendingGestureIds = (gestureIds: readonly string[]) => {
  const seen = new Set<string>();
  const retained: string[] = [];
  const discarded: string[] = [];
  for (let index = gestureIds.length - 1; index >= 0; index -= 1) {
    const gestureId = gestureIds[index];
    if (seen.has(gestureId)) continue;
    seen.add(gestureId);
    if (retained.length < MAX_PENDING_GESTURE_IDS) retained.push(gestureId);
    else discarded.push(gestureId);
  }
  return { retained: retained.reverse(), discarded: discarded.reverse() };
};
