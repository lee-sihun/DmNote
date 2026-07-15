import type { KeyPosition } from '@src/types/key/keys';

// Built-in statistics item types (plugin 없이 사용되는 통계 요소)
export const STAT_ITEM_TYPES = ['kps', 'kpsAvg', 'kpsMax', 'total'] as const;
export type StatItemType = (typeof STAT_ITEM_TYPES)[number];

export const STAT_BASE_OPTIONS = [
  { label: 'KPS', value: 'kps' },
  { label: 'Total', value: 'total' },
] satisfies Array<{ label: string; value: StatItemType }>;

export const STAT_KPS_OPTIONS = [
  { label: 'KPS', value: 'kps' },
  { label: 'AVG', value: 'kpsAvg' },
  { label: 'MAX', value: 'kpsMax' },
] satisfies Array<{ label: string; value: StatItemType }>;

// KeyPosition 기반으로 스타일을 공유하고, statType으로 값 종류만 구분
export type StatItemPosition = KeyPosition & { statType: StatItemType };

export type StatItemPositions = Record<string, StatItemPosition[]>;
