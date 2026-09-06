import { describe, expect, it } from 'vitest';
import type { GraphItemPosition } from '@src/types/key/graphItems';
import { aggregateMixedValue } from '@src/renderer/components/main/Grid/PropertiesPanel/batch/mixedValue';
import {
  createBatchGraphSettingsModel,
  snapBatchGraphSpeed,
} from './batchGraphSettingsModel';

const graph = (patch: Partial<GraphItemPosition> = {}): GraphItemPosition =>
  ({
    graphType: 'line',
    graphSpeed: 1000,
    graphColor: '#86EFAC',
    showAvgLine: true,
    graphAnimationEnabled: true,
    ...patch,
  } as GraphItemPosition);

describe('batch graph settings model', () => {
  it('타입·속도·색상 채널의 Mixed와 line 포함 여부를 같은 선택에서 계산한다', () => {
    const positions = [
      graph({ graphColor: 'rgba(255, 0, 0, 0.5)' }),
      graph({
        graphType: 'bar',
        graphSpeed: 1200,
        graphColor: 'rgba(255, 0, 0, 1)',
      }),
    ];
    const getMixedValue = <Value>(
      getter: (position: GraphItemPosition) => Value | undefined,
      defaultValue: Value,
    ) => aggregateMixedValue(positions, getter, defaultValue);

    const model = createBatchGraphSettingsModel(getMixedValue, positions);

    expect(model.graphType.isMixed).toBe(true);
    expect(model.graphSpeed.isMixed).toBe(true);
    expect(model.graphColorMixed).toEqual({ hex: false, alpha: true });
    expect(model.hasLineGraph).toBe(true);
  });

  it.each([
    [0, 500],
    [549, 500],
    [550, 600],
    [1249, 1200],
    [1250, 1300],
    [9000, 5000],
  ])(
    '속도 %dms를 기존 clamp·100ms snap 규칙으로 %dms에 맞춘다',
    (input, expected) => {
      expect(snapBatchGraphSpeed(input)).toBe(expected);
    },
  );
});
