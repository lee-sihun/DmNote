import { signal, type Signal } from '@preact/signals-react';

// globalKey -> Signal<boolean> 매핑
const keySignals = new Map<string, Signal<boolean>>();

export function getKeySignal(key: string): Signal<boolean> {
  let s = keySignals.get(key);
  if (!s) {
    s = signal(false);
    keySignals.set(key, s);
  }
  return s;
}

export function setKeyActive(key: string, isActive: boolean) {
  getKeySignal(key).value = isActive;
}

export function resetAllKeySignals() {
  for (const s of keySignals.values()) s.value = false;
}
