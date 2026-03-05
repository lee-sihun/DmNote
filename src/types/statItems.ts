import type { KeyPosition } from '@src/types/keys';

// Built-in statistics item types (plugin 없이 사용되는 통계 요소)
export type StatItemType = 'kps' | 'kpsAvg' | 'kpsMax' | 'total';

// KeyPosition 기반으로 스타일을 공유하고, statType으로 값 종류만 구분
export type StatItemPosition = KeyPosition & { statType: StatItemType };

export type StatItemPositions = Record<string, StatItemPosition[]>;
