import { signal, type Signal } from '@preact/signals-react';

// axisId -> Signal<number>: 누적 회전수(wrap 델타를 축 해상도로 정규화한 값).
// 물리 1회전 ≈ 1.0. 각 KnobItem이 ×360×배율(sensitivity)/방향을 적용해 회전.
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
