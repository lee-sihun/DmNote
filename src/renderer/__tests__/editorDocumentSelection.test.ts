// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyEditorDocument } from '@src/renderer/editor/runtime/editorStateCoordinator';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import type { EditorDocumentV1 } from '@src/types/editor';
import type { StatItemPosition } from '@src/types/key/statItems';

const makeStat = (x = 0): StatItemPosition => ({
  ...createDefaultKeyPosition(),
  dx: x,
  statType: 'kps',
});

const makeDocument = (): EditorDocumentV1 => ({
  schemaVersion: 1,
  keys: { '4key': ['B'] },
  keyPositions: { '4key': [createDefaultKeyPosition()] },
  statPositions: { '4key': [] },
  graphPositions: { '4key': [] },
  knobPositions: { '4key': [] },
  layerGroups: { '4key': [] },
});

describe('editor document 적용 선택 정합성', () => {
  beforeEach(() => {
    const document = makeDocument();
    useKeyStore.setState({
      selectedKeyType: '4key',
      keyMappings: document.keys,
      positions: document.keyPositions,
      isBootstrapped: false,
    });
    useStatItemStore.setState({ positions: document.statPositions });
    useGraphItemStore.setState({ positions: document.graphPositions });
    useKnobItemStore.setState({ positions: document.knobPositions });
    useLayerGroupStore.setState({ layerGroups: document.layerGroups });
    useGridSelectionStore.getState().clearSelection();
  });

  afterEach(() => useGridSelectionStore.getState().clearSelection());

  it('선택된 종류의 배열 길이가 바뀌면 해당 선택을 무효화한다', () => {
    useGridSelectionStore
      .getState()
      .setSelectedElements([{ type: 'key', id: 'key-0', index: 0 }]);
    const next = makeDocument();
    next.keys['4key'] = ['A', 'B'];
    next.keyPositions['4key'] = [
      createDefaultKeyPosition(),
      createDefaultKeyPosition(),
    ];

    applyEditorDocument(next);

    expect(useGridSelectionStore.getState().selectedElements).toEqual([]);
  });

  it('길이가 같은 스타일 갱신은 현재 선택을 보존한다', () => {
    const selection = [{ type: 'key' as const, id: 'key-0', index: 0 }];
    useGridSelectionStore.getState().setSelectedElements(selection);
    const selectionReference =
      useGridSelectionStore.getState().selectedElements;
    const next = makeDocument();
    next.keyPositions['4key'][0] = {
      ...next.keyPositions['4key'][0],
      backgroundColor: '#123456',
    };

    applyEditorDocument(next);

    expect(useGridSelectionStore.getState().selectedElements).toBe(
      selectionReference,
    );
  });

  it('배열 끝 추가는 앞쪽의 유효한 선택을 보존한다', () => {
    const selection = [{ type: 'key' as const, id: 'key-0', index: 0 }];
    useGridSelectionStore.getState().setSelectedElements(selection);
    const selectionReference =
      useGridSelectionStore.getState().selectedElements;
    const next = makeDocument();
    next.keys['4key'] = ['B', 'C'];
    next.keyPositions['4key'] = [
      createDefaultKeyPosition(),
      createDefaultKeyPosition(),
    ];

    applyEditorDocument(next);

    expect(useGridSelectionStore.getState().selectedElements).toBe(
      selectionReference,
    );
  });

  it('다른 종류의 배열 길이 변경은 관련 없는 선택을 보존한다', () => {
    useStatItemStore.setState({ positions: { '4key': [makeStat(10)] } });
    useGridSelectionStore.getState().setSelectedElements([
      { type: 'key', id: 'key-0', index: 0 },
      { type: 'stat', id: 'stat-0', index: 0 },
      { type: 'plugin', id: 'plugin:test' },
    ]);
    const next = makeDocument();
    next.statPositions['4key'] = [makeStat(), makeStat(10)];

    applyEditorDocument(next);

    expect(useGridSelectionStore.getState().selectedElements).toEqual([
      { type: 'key', id: 'key-0', index: 0 },
      { type: 'plugin', id: 'plugin:test' },
    ]);
  });
});
