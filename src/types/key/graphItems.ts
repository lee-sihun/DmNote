import type { KeyPosition } from '@src/types/key/keys';
import type { StatItemType } from '@src/types/key/statItems';

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
