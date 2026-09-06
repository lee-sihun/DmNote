import type {
  GraphItemPosition,
  GraphItemType,
} from '@src/types/key/graphItems';
import { parseAlphaPercent, toRgbHexColor } from '@utils/color/colorUtils';
import type { MixedValueGetter, MixedValueResult } from '../batchPanelShared';

export interface BatchGraphSettingsModel {
  graphType: MixedValueResult<GraphItemType>;
  showAvgLine: MixedValueResult<boolean>;
  graphSpeed: MixedValueResult<number>;
  graphColor: MixedValueResult<string>;
  graphColorMixed: { hex: boolean; alpha: boolean };
  graphAnimation: MixedValueResult<boolean>;
  hasLineGraph: boolean;
}

export const snapBatchGraphSpeed = (value: number): number => {
  const clamped = Math.max(500, Math.min(5000, value));
  return Math.round(clamped / 100) * 100;
};

export const createBatchGraphSettingsModel = (
  getMixedValue: MixedValueGetter<GraphItemPosition>,
  selectedPositions: readonly GraphItemPosition[],
): BatchGraphSettingsModel => ({
  graphType: getMixedValue((position) => position.graphType || 'line', 'line'),
  showAvgLine: getMixedValue((position) => position.showAvgLine ?? true, true),
  graphSpeed: getMixedValue(
    (position) => Math.round(position.graphSpeed || 1000),
    1000,
  ),
  graphColor: getMixedValue(
    (position) => position.graphColor || '#86EFAC',
    '#86EFAC',
  ),
  graphColorMixed: {
    hex: getMixedValue(
      (position) => toRgbHexColor(position.graphColor || '#86EFAC'),
      '',
    ).isMixed,
    alpha: getMixedValue(
      (position) => parseAlphaPercent(position.graphColor || '#86EFAC'),
      100,
    ).isMixed,
  },
  graphAnimation: getMixedValue(
    (position) => position.graphAnimationEnabled ?? true,
    true,
  ),
  hasLineGraph: selectedPositions.some(
    (position) => (position.graphType || 'line') === 'line',
  ),
});
