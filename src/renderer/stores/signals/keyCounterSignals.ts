import { signal, type Signal } from '@preact/signals-react';
import type { KeyCounters } from '@src/types/key/keys';

const keyCounterSignals = new Map<string, Signal<number>>();

const composeKey = (mode: string, key: string) => `${mode}::${key}`;

export function getKeyCounterSignal(mode: string, key: string): Signal<number> {
  const safeMode = mode || '__unknown_mode__';
  const safeKey = key || '__unknown_key__';
  const composed = composeKey(safeMode, safeKey);
  let s = keyCounterSignals.get(composed);
  if (!s) {
    s = signal(0);
    keyCounterSignals.set(composed, s);
  }
  return s;
}

export function setKeyCounter(mode: string, key: string, value: number) {
  const signalRef = getKeyCounterSignal(mode, key);
  signalRef.value = value;
}

export function getCounterSnapshot(): KeyCounters {
  const snapshot: KeyCounters = {};
  for (const [composed, signalRef] of keyCounterSignals.entries()) {
    const [mode, key] = composed.split('::');
    if (!snapshot[mode]) {
      snapshot[mode] = {};
    }
    snapshot[mode]![key] = signalRef.value ?? 0;
  }
  return snapshot;
}

// shouldSkip: 적용/zeroing에서 제외할 composed key("mode::key") 판정
// (예: 딜레이 타이머로 더 최신 값이 대기 중인 키를 스냅샷이 덮지 않도록)
export function applyCounterSnapshot(
  counters: KeyCounters,
  shouldSkip?: (composedKey: string) => boolean,
) {
  const seen = new Set<string>();
  Object.entries(counters).forEach(([mode, counter]) => {
    Object.entries(counter).forEach(([key, value]) => {
      const composed = composeKey(mode, key);
      seen.add(composed);
      if (!shouldSkip?.(composed)) {
        setKeyCounter(mode, key, value);
      }
    });
  });
  for (const [composed] of keyCounterSignals) {
    if (!seen.has(composed) && !shouldSkip?.(composed)) {
      keyCounterSignals.get(composed)!.value = 0;
    }
  }
}

export function resetAllCounters() {
  for (const signalRef of keyCounterSignals.values()) {
    signalRef.value = 0;
  }
}
