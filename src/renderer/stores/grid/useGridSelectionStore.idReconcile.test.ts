import { beforeEach, describe, expect, it } from 'vitest';

import {
  invalidateSelectionForChangedIndexedElementArrays,
  useGridSelectionStore,
  type IndexedElementArrays,
} from './useGridSelectionStore';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';

import type { CanonicalKeyPosition } from '@src/types/editor';

const arraysOf = (
  keyPositions: CanonicalKeyPosition[],
): IndexedElementArrays => ({
  keyMappings: keyPositions.map(() => 'A'),
  keyPositions,
  stat: [],
  graph: [],
  knob: [],
  sprite: [],
});

describe('id 기반 선택 재조정', () => {
  const a = {
    ...createDefaultKeyPosition(),
    id: '11111111-1111-4111-8111-111111111111',
  };
  const b = {
    ...createDefaultKeyPosition(),
    id: '22222222-2222-4222-8222-222222222222',
  };

  beforeEach(() => {
    useGridSelectionStore.setState({ selectedElements: [] });
  });

  it('재정렬되면 선택이 같은 요소를 따라간다 (index 갱신, id 유지)', () => {
    useGridSelectionStore
      .getState()
      .setSelectedElements([{ type: 'key', id: a.id, index: 0 }]);

    invalidateSelectionForChangedIndexedElementArrays(
      arraysOf([a, b]),
      arraysOf([b, a]),
    );

    const [selected] = useGridSelectionStore.getState().selectedElements;
    expect(selected.id).toBe(a.id);
    expect(selected.index).toBe(1);
  });

  it('요소가 삭제되면 그 선택만 풀린다', () => {
    useGridSelectionStore.getState().setSelectedElements([
      { type: 'key', id: a.id, index: 0 },
      { type: 'key', id: b.id, index: 1 },
    ]);

    invalidateSelectionForChangedIndexedElementArrays(
      arraysOf([a, b]),
      arraysOf([b]),
    );

    const selected = useGridSelectionStore.getState().selectedElements;
    expect(selected).toHaveLength(1);
    expect(selected[0].id).toBe(b.id);
    expect(selected[0].index).toBe(0);
  });

  it('변화가 없으면 선택 참조를 보존한다', () => {
    useGridSelectionStore
      .getState()
      .setSelectedElements([{ type: 'key', id: a.id, index: 0 }]);
    const reference = useGridSelectionStore.getState().selectedElements;

    invalidateSelectionForChangedIndexedElementArrays(
      arraysOf([a, b]),
      arraysOf([a, b]),
    );

    expect(useGridSelectionStore.getState().selectedElements).toBe(reference);
  });
});
