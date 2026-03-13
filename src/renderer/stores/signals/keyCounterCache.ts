import type { KeyCounters } from '@src/types/key/keys';

let keyCounterCache: KeyCounters = {};

const cloneCounters = (counters: KeyCounters): KeyCounters =>
  JSON.parse(JSON.stringify(counters)) as KeyCounters;

export function getCounterCacheSnapshot(): KeyCounters {
  return cloneCounters(keyCounterCache);
}

export function applyCounterCacheSnapshot(counters: KeyCounters) {
  keyCounterCache = cloneCounters(counters);
}

export function setCachedKeyCounter(mode: string, key: string, value: number) {
  if (!keyCounterCache[mode]) {
    keyCounterCache[mode] = {};
  }
  keyCounterCache[mode]![key] = value;
}
