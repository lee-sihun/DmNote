import { signal, type Signal } from '@preact/signals-react';

// axisId -> Signal<number>: 누적 wrap 델타 합(축 raw 단위).
// 각 DialItem이 이 값에 자신의 민감도/방향을 곱해 회전 각도로 사용.
const axisSignals = new Map<string, Signal<number>>();

export function getAxisSignal(axisId: string): Signal<number> {
  let s = axisSignals.get(axisId);
  if (!s) {
    s = signal(0);
    axisSignals.set(axisId, s);
  }
  return s;
}

export function addAxisDelta(axisId: string, delta: number) {
  if (delta === 0) return;
  getAxisSignal(axisId).value += delta;
}

export function resetAllAxisSignals() {
  for (const s of axisSignals.values()) s.value = 0;
}
