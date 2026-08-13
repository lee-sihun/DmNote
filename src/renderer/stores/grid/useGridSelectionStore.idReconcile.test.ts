import { beforeEach, describe, expect, it } from 'vitest';

import {
  invalidateSelectionForChangedIndexedElementArrays,
  selectionElementId,
  useGridSelectionStore,
} from './useGridSelectionStore';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';

import type { KeyPosition } from '@src/types/key/keys';

const arraysOf = (keyPositions: KeyPosition[]) => ({
  keyMappings: keyPositions.map(() => 'A'),
  keyPositions,
  stat: [] as unknown[],
  graph: [] as unknown[],
  knob: [] as unknown[],
});

describe('id 기반 선택 재조정', () => {
  const a = createDefaultKeyPosition();
  const b = createDefaultKeyPosition();

  beforeEach(() => {
    useGridSelectionStore.setState({ selectedElements: [] });
  });

  it('재정렬되면 선택이 같은 요소를 따라간다 (index 갱신, id 유지)', () => {
    useGridSelectionStore
      .getState()
      .setSelectedElements([
        { type: 'key', id: selectionElementId('key', a, 0), index: 0 },
      ]);

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
      { type: 'key', id: a.id!, index: 0 },
      { type: 'key', id: b.id!, index: 1 },
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

  it('백엔드가 id를 재발급해도 같은 자리의 선택을 유지한다', () => {
    useGridSelectionStore
      .getState()
      .setSelectedElements([{ type: 'key', id: a.id!, index: 1 }]);
    // 탭 프리셋 rekey·v1 어댑터 재발급처럼 요소는 그대로인데 신원만 새로
    // 발급되는 경우 - 길이가 그대로면 자리로 재채택한다
    const rekeyedA = { ...a, id: 'rekeyed-a' };
    const rekeyedB = { ...b, id: 'rekeyed-b' };

    invalidateSelectionForChangedIndexedElementArrays(
      arraysOf([b, a]),
      arraysOf([rekeyedB, rekeyedA]),
    );

    const selected = useGridSelectionStore.getState().selectedElements;
    expect(selected).toHaveLength(1);
    expect(selected[0].id).toBe('rekeyed-a');
    expect(selected[0].index).toBe(1);
  });

  it('길이가 바뀌면 재채택 대신 경계 판정을 따른다', () => {
    useGridSelectionStore
      .getState()
      .setSelectedElements([{ type: 'key', id: a.id!, index: 1 }]);

    invalidateSelectionForChangedIndexedElementArrays(
      arraysOf([b, a]),
      arraysOf([b]),
    );

    expect(useGridSelectionStore.getState().selectedElements).toHaveLength(0);
  });

  it('변화가 없으면 선택 참조를 보존한다', () => {
    useGridSelectionStore
      .getState()
      .setSelectedElements([{ type: 'key', id: a.id!, index: 0 }]);
    const reference = useGridSelectionStore.getState().selectedElements;

    invalidateSelectionForChangedIndexedElementArrays(
      arraysOf([a, b]),
      arraysOf([a, b]),
    );

    expect(useGridSelectionStore.getState().selectedElements).toBe(reference);
  });
});
