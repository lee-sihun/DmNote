import { signal, type Signal } from '@preact/signals-react';
import type { KeyStatsPayload } from '@src/types/plugin/api';
import type { StatItemType } from '@src/types/key/statItems';

const statsSignals: Record<keyof KeyStatsPayload, Signal<number>> = {
  kps: signal(0),
  kpsAvg: signal(0),
  kpsMax: signal(0),
  total: signal(0),
};

export function applyStatsSnapshot(snapshot: KeyStatsPayload) {
  statsSignals.kps.value = snapshot.kps | 0;
  statsSignals.kpsAvg.value = snapshot.kpsAvg | 0;
  statsSignals.kpsMax.value = snapshot.kpsMax | 0;
  statsSignals.total.value = snapshot.total | 0;
}

export function getStatValueSignal(statType: StatItemType): Signal<number> {
  switch (statType) {
    case 'kpsAvg':
      return statsSignals.kpsAvg;
    case 'kpsMax':
      return statsSignals.kpsMax;
    case 'total':
      return statsSignals.total;
    case 'kps':
    default:
      return statsSignals.kps;
  }
}

export function getStatsSnapshot(): KeyStatsPayload {
  return {
    kps: statsSignals.kps.value,
    kpsAvg: statsSignals.kpsAvg.value,
    kpsMax: statsSignals.kpsMax.value,
    total: statsSignals.total.value,
  };
}
