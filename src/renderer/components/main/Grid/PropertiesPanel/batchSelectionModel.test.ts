import { describe, expect, it } from 'vitest';
import type { GraphItemPosition } from '@src/types/key/graphItems';
import type { KeyPosition } from '@src/types/key/keys';
import type { KnobItemPosition } from '@src/types/key/knobs';
import type { StatItemPosition } from '@src/types/key/statItems';
import {
  createBatchSelectionModel,
  type BatchSelectionModelInput,
} from './batchSelectionModel';

const keyPosition = (
  id: string,
  patch: Partial<KeyPosition> = {},
): KeyPosition =>
  ({ id, dx: 0, dy: 0, width: 60, height: 60, ...patch } as KeyPosition);

const createInput = (): BatchSelectionModelInput => {
  const key = keyPosition('key-1', { width: 60 });
  const canonicalKey = keyPosition('key-1', { width: 40 });
  const stat = {
    ...keyPosition('stat-1', { width: 80 }),
    statType: 'total',
  } as StatItemPosition;
  const graph = {
    ...keyPosition('graph-1'),
    statType: 'kpsMax',
    graphType: 'line',
    graphSpeed: 1,
    graphColor: '#fff',
  } as GraphItemPosition;
  const knob = {
    ...keyPosition('knob-1'),
    axisId: 'axis',
    sensitivity: 1,
    reverse: false,
  } as KnobItemPosition;

  return {
    selectedKeyType: '4key',
    positions: { '4key': [key] },
    canonicalPositions: { '4key': [canonicalKey] },
    keyMappings: { '4key': ['KeyA'] },
    statItemPositions: { '4key': [stat] },
    graphItemPositions: { '4key': [graph] },
    knobItemPositions: { '4key': [knob] },
    selectedKeyElements: [{ type: 'key', id: 'key-1' }],
    selectedKeyLikeElements: [
      { type: 'key', id: 'key-1' },
      { type: 'stat', id: 'stat-1' },
    ],
    selectedGraphElements: [{ type: 'graph', id: 'graph-1' }],
    selectedKnobElements: [{ type: 'knob', id: 'knob-1' }],
    selectedBatchStyleElements: [
      { type: 'stat', id: 'stat-1' },
      { type: 'key', id: 'key-1' },
      { type: 'graph', id: 'graph-1' },
      { type: 'knob', id: 'knob-1' },
    ],
  };
};

describe('createBatchSelectionModel', () => {
  it('유형별 선택 데이터를 안정 ID와 선택 순서로 해석한다', () => {
    const model = createBatchSelectionModel(createInput());

    expect(
      model.getSelectedKeysData().map(({ position }) => position.id),
    ).toEqual(['key-1', 'stat-1']);
    expect(model.getSelectedKeysData()[1].keyInfo?.displayName).toBe('Total');
    expect(model.getSelectedGraphsData()[0].keyInfo?.displayName).toBe(
      'MAX Graph',
    );
    expect(model.getSelectedKnobsData()[0].keyInfo?.displayName).toBe('Knob');
    expect(
      model.getSelectedBatchStyleData().map(({ position }) => position.id),
    ).toEqual(['stat-1', 'key-1', 'graph-1', 'knob-1']);
  });

  it('렌더 위치와 canonical 위치의 혼합 값 계산을 분리한다', () => {
    const model = createBatchSelectionModel(createInput());

    expect(model.getMixedValue((position) => position.width, 0)).toEqual({
      isMixed: true,
      value: 60,
    });
    expect(
      model.getMixedValueCanonical((position) => position.width, 0),
    ).toEqual({ isMixed: false, value: 40 });
  });
});
