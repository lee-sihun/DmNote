// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGridCanvasActions } from '@hooks/Grid/useGridCanvasActions';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';
import type { StatItemPosition } from '@src/types/key/statItems';
import type { GraphItemPosition } from '@src/types/key/graphItems';
import type { KnobItemPosition } from '@src/types/key/knobs';

vi.mock('@stores/data/useHistoryStore', () => ({
  useHistoryStore: {
    getState: () => ({ pushState: vi.fn() }),
  },
}));

const makeStat = (): StatItemPosition => ({
  ...createDefaultKeyPosition(),
  statType: 'kps',
});

const makeGraph = (): GraphItemPosition => ({
  ...createDefaultKeyPosition(),
  statType: 'kps',
  graphType: 'line',
  graphSpeed: 1000,
  graphColor: '#ffffff',
});

const makeKnob = (): KnobItemPosition => ({
  ...createDefaultKeyPosition(),
  axisId: '',
  sensitivity: 1,
  reverse: false,
});

describe('캔버스 요소 삭제 선택 정리', () => {
  const originalApi = window.api;
  const updateStatPositions = vi.fn();
  const updateGraphPositions = vi.fn();
  const updateKnobPositions = vi.fn();

  beforeEach(() => {
    updateStatPositions.mockResolvedValue(undefined);
    updateGraphPositions.mockResolvedValue(undefined);
    updateKnobPositions.mockResolvedValue(undefined);
    window.api = {
      statItems: { updatePositions: updateStatPositions },
      graphItems: { updatePositions: updateGraphPositions },
      knobItems: { updatePositions: updateKnobPositions },
    } as unknown as Window['api'];
    useKeyStore.setState({
      selectedKeyType: '4key',
      keyMappings: { '4key': [] },
      positions: { '4key': [] },
      isBootstrapped: false,
    });
    useStatItemStore.setState({
      positions: { '4key': [makeStat(), makeStat(), makeStat()] },
      isLocalUpdateInProgress: false,
    });
    useGraphItemStore.setState({
      positions: { '4key': [makeGraph(), makeGraph(), makeGraph()] },
      isLocalUpdateInProgress: false,
    });
    useKnobItemStore.setState({
      positions: { '4key': [makeKnob(), makeKnob(), makeKnob()] },
      isLocalUpdateInProgress: false,
    });
    useGridSelectionStore.getState().clearSelection();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.api = originalApi;
    useGridSelectionStore.getState().clearSelection();
  });

  it('통계 실제 삭제 핸들러가 선택을 제거하고 후속 인덱스를 당긴다', () => {
    useGridSelectionStore.getState().setSelectedElements([
      { type: 'stat', id: 'stat-0', index: 0 },
      { type: 'stat', id: 'stat-2', index: 2 },
      { type: 'graph', id: 'graph-1', index: 1 },
    ]);

    useGridCanvasActions('4key').deleteStatAtIndex(0);

    expect(useGridSelectionStore.getState().selectedElements).toEqual([
      { type: 'stat', id: 'stat-1', index: 1 },
      { type: 'graph', id: 'graph-1', index: 1 },
    ]);
    expect(useStatItemStore.getState().positions['4key']).toHaveLength(2);
  });

  it('그래프 실제 삭제 핸들러가 선택을 제거하고 후속 인덱스를 당긴다', () => {
    useGridSelectionStore.getState().setSelectedElements([
      { type: 'graph', id: 'graph-0', index: 0 },
      { type: 'graph', id: 'graph-2', index: 2 },
      { type: 'knob', id: 'knob-1', index: 1 },
    ]);

    useGridCanvasActions('4key').deleteGraphAtIndex(0);

    expect(useGridSelectionStore.getState().selectedElements).toEqual([
      { type: 'graph', id: 'graph-1', index: 1 },
      { type: 'knob', id: 'knob-1', index: 1 },
    ]);
    expect(useGraphItemStore.getState().positions['4key']).toHaveLength(2);
  });

  it('노브 실제 삭제 핸들러가 선택을 제거하고 후속 인덱스를 당긴다', () => {
    useGridSelectionStore.getState().setSelectedElements([
      { type: 'knob', id: 'knob-0', index: 0 },
      { type: 'knob', id: 'knob-2', index: 2 },
      { type: 'key', id: 'key-1', index: 1 },
    ]);

    useGridCanvasActions('4key').deleteKnobAtIndex(0);

    expect(useGridSelectionStore.getState().selectedElements).toEqual([
      { type: 'knob', id: 'knob-1', index: 1 },
      { type: 'key', id: 'key-1', index: 1 },
    ]);
    expect(useKnobItemStore.getState().positions['4key']).toHaveLength(2);
  });
});
