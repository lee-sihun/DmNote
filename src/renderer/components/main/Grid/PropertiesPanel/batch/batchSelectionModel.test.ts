import { describe, expect, it } from 'vitest';
import type { GraphItemPosition } from '@src/types/key/graphItems';
import type { KeyPosition } from '@src/types/key/keys';
import type { KnobItemPosition } from '@src/types/key/knobs';
import type { StatItemPosition } from '@src/types/key/statItems';
import { makeCanonicalSpritePosition } from '@utils/sprite/spriteFixtures';
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
    spriteItemPositions: {
      '4key': [
        makeCanonicalSpritePosition({
          id: 'sprite-1',
          width: 200,
          height: 200,
        }),
      ],
    },
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
    selectedBatchGeometryElements: [
      { type: 'stat', id: 'stat-1' },
      { type: 'key', id: 'key-1' },
      { type: 'graph', id: 'graph-1' },
      { type: 'knob', id: 'knob-1' },
      { type: 'sprite', id: 'sprite-1' },
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

  // 크기 입력은 resize 대상 집합을 읽는다 - 스타일 집합만 보면 스프라이트 값이 가려진다
  it('크기 혼합 값은 스프라이트를 포함한 기하 집합에서 집계한다', () => {
    const input = createInput();
    input.selectedBatchStyleElements = [{ type: 'key', id: 'key-1' }];
    input.selectedBatchGeometryElements = [
      { type: 'key', id: 'key-1' },
      { type: 'sprite', id: 'sprite-1' },
    ];
    const model = createBatchSelectionModel(input);

    expect(model.getMixedValueBatch((position) => position.width, 0)).toEqual({
      isMixed: false,
      value: 60,
    });
    expect(
      model.getMixedValueGeometry((position) => position.width, 0),
    ).toEqual({ isMixed: true, value: 60 });
  });

  it('누락 ID를 제외하고 생성 시점의 선택 snapshot을 재사용한다', () => {
    const input = createInput();
    input.selectedKeyLikeElements = [
      { type: 'stat', id: 'missing-stat' },
      ...input.selectedKeyLikeElements,
      { type: 'key', id: 'missing-key' },
    ];
    input.selectedGraphElements = [
      { type: 'graph', id: 'missing-graph' },
      ...input.selectedGraphElements,
    ];
    const model = createBatchSelectionModel(input);

    expect(model.getSelectedKeysData()).toBe(model.getSelectedKeysData());
    expect(model.getSelectedGraphsData()).toBe(model.getSelectedGraphsData());
    expect(
      model.getSelectedKeysData().map(({ position }) => position.id),
    ).toEqual(['key-1', 'stat-1']);
    expect(
      model.getSelectedGraphsData().map(({ position }) => position.id),
    ).toEqual(['graph-1']);
  });

  it('중복 ID는 findIndex와 같은 첫 위치를 사용하고 canonical 중복은 모두 집계한다', () => {
    const input = createInput();
    input.positions['4key'] = [
      keyPosition('key-1', { width: 31 }),
      keyPosition('key-1', { width: 99 }),
    ];
    input.keyMappings['4key'] = ['KeyB', 'KeyC'];
    input.canonicalPositions['4key'] = [
      keyPosition('key-1', { width: 41 }),
      keyPosition('key-1', { width: 51 }),
    ];
    const model = createBatchSelectionModel(input);

    expect(model.getSelectedKeysData()[0]).toMatchObject({
      index: 0,
      position: { width: 31 },
      keyCode: 'KeyB',
    });
    expect(
      model.getMixedValueCanonical((position) => position.width, 0),
    ).toEqual({ isMixed: true, value: 41 });
  });
});
