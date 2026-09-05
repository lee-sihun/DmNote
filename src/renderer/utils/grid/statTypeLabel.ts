import type { StatItemType } from '@src/types/key/statItems';

const STAT_TYPE_LABELS: Record<StatItemType, string> = {
  kps: 'KPS',
  kpsAvg: 'AVG',
  kpsMax: 'MAX',
  total: 'Total',
};

export const getStatTypeLabel = (statType?: StatItemType | null): string =>
  STAT_TYPE_LABELS[statType ?? 'kps'] ?? 'KPS';

export const getLooseStatTypeLabel = (statType: string): string =>
  STAT_TYPE_LABELS[statType as StatItemType] ?? String(statType || '');
