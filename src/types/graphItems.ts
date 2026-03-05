import type { KeyPosition } from '@src/types/keys';
import type { StatItemType } from '@src/types/statItems';

export type GraphItemType = 'line' | 'bar';
export type GraphMetricType = StatItemType;

export type GraphItemPosition = KeyPosition & {
  statType: GraphMetricType;
  graphType: GraphItemType;
  graphSpeed: number;
  graphColor: string;
  showAvgLine?: boolean;
};

export type GraphItemPositions = Record<string, GraphItemPosition[]>;
