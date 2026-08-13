import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultKeyPosition } from '../model/keys';
import type {
  EditorCounterLayoutPropertyPatchV1,
  EditorCounterTypographyPropertyPatchV1,
} from '@src/types/editor';

const api = vi.hoisted(() => ({
  commitGeneratedPatch: vi.fn(),
  commitGeneratedSemanticOps: vi.fn(),
  commitSemanticOps: vi.fn(),
  captureEditorDocument: vi.fn(),
  lastAck: null as EditorDocumentV1 | null,
}));

vi.mock('./editorStateCoordinator', () => ({
  editorCoordinator: {
    commitGeneratedPatch: api.commitGeneratedPatch,
    getState: () => ({ lastAck: api.lastAck }),
  },
  captureEditorDocument: api.captureEditorDocument,
}));

vi.mock('./editorSemanticOps', () => ({
  commitGeneratedSemanticOps: api.commitGeneratedSemanticOps,
  commitSemanticOps: api.commitSemanticOps,
}));

import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import {
  addGraphAt,
  addKeyAt,
  addKnobAt,
  addStatAt,
  applyZOrderByIds,
  commitBatchGeometryByIds,
  commitElementGeometryById,
  commitElementBoundsById,
  commitSingleElementBoundsById,
  commitSelectedGeometryByIds,
  deleteElementById,
  placeDuplicatedKey,
  placeDuplicatedGraph,
  placeDuplicatedKnob,
  placeDuplicatedStat,
  patchElementHiddenById,
  setLayerGroupHidden,
  setLayerGroupHiddenLegacy,
  patchElementLayerNameById,
  patchFontStyleById,
  patchFontStyleByTargets,
  patchFontFamilyById,
  patchFontFamilyByTargets,
  patchGraphColorById,
  patchGraphColorsByIds,
  patchGraphPropertiesByIds,
  patchGraphPropertyById,
  patchGraphTypeById,
  patchGraphTypesByIds,
  patchKnobPropertiesByIds,
  patchKnobPropertyById,
  patchKnobAxisIdById,
  patchSoundEnabledById,
  patchSoundEnabledByIds,
  patchSoundPathById,
  patchSoundPathByIds,
  patchSoundVolumeById,
  patchSoundVolumeByIds,
  patchCounterAnimationEnabledByTargets,
  patchCounterAnimationPresetByTargets,
  patchCounterEnabledByTargets,
  patchCounterLayoutByTargets,
  patchCounterTypographyByTargets,
  patchInactiveImageById,
  patchInactiveImageByTargets,
  patchActiveImageById,
  patchActiveImageByTargets,
  patchIdleTransparentById,
  patchIdleTransparentByTargets,
  patchActiveTransparentById,
  patchActiveTransparentByTargets,
  patchIdleImageFitById,
  patchActiveImageFitById,
  patchNotePropertiesByIds,
  patchNotePropertyById,
  patchStatTypeById,
  patchUseInlineStylesById,
  patchUseInlineStylesByTargets,
  rebindKeySlotById,
} from './elementOps';

import {
  enqueueEditorCompatibilityOperation,
  enqueueEditorCompatibilityWrite,
} from './editorCompatibilityQueue';

import type { EditorDocumentV1, EditorPatchV1 } from '@src/types/editor';
import type { GraphItemPosition } from '@src/types/key/graphItems';

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';

const keyAt = (id: string, zIndex?: number) => ({
  ...createDefaultKeyPosition(),
  id,
  ...(zIndex !== undefined ? { zIndex } : {}),
});

const graphAt = (
  id: string,
  patch: Partial<GraphItemPosition> = {},
): GraphItemPosition => ({
  ...createDefaultKeyPosition(),
  id,
  statType: 'kps',
  graphType: 'line',
  graphSpeed: 1000,
  graphColor: '#86EFAC',
  ...patch,
});

// 슬롯 시점 base. 기본은 호출 시점 스토어 - 대기 중 재정렬·삭제는 테스트가
// slotBase로 재현한다
let slotBase: (() => EditorDocumentV1) | null = null;
const generatedPatches: Array<EditorPatchV1 | null> = [];

const documentFromStores = (): EditorDocumentV1 =>
  ({
    schemaVersion: 1,
    keys: structuredClone(useKeyStore.getState().keyMappings),
    keyPositions: structuredClone(useKeyStore.getState().canonicalPositions),
    statPositions: structuredClone(useStatItemStore.getState().positions),
    graphPositions: structuredClone(useGraphItemStore.getState().positions),
    knobPositions: structuredClone(useKnobItemStore.getState().positions),
    layerGroups: structuredClone(useLayerGroupStore.getState().layerGroups),
  } as unknown as EditorDocumentV1);

describe('elementOps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    slotBase = null;
    generatedPatches.length = 0;
    api.lastAck = null;
    api.captureEditorDocument.mockImplementation(() => documentFromStores());
    api.commitGeneratedPatch.mockImplementation(
      async (generate: (base: EditorDocumentV1) => EditorPatchV1 | null) => {
        const base = (slotBase ?? documentFromStores)();
        generatedPatches.push(generate(base));
        return base;
      },
    );
    api.commitSemanticOps.mockImplementation((_ops, meta) =>
      enqueueEditorCompatibilityOperation(async () => {
        meta?.onEnrolled?.();
        return {
          document: documentFromStores(),
          opResults: _ops.map((op) =>
            op.kind === 'setBounds'
              ? { status: 'applied', bounds: op.bounds }
              : { status: 'applied' },
          ),
        };
      }),
    );
    api.commitGeneratedSemanticOps.mockImplementation((generate, meta) =>
      enqueueEditorCompatibilityOperation(async () => {
        const ops = generate((slotBase ?? documentFromStores)());
        if (!ops) return null;
        meta?.preflight?.();
        meta?.onEnrolled?.();
        return {
          document: documentFromStores(),
          opResults: ops.map((op) =>
            op.kind === 'setBounds'
              ? { status: 'applied', bounds: op.bounds }
              : { status: 'applied' },
          ),
        };
      }),
    );
    useKeyStore.setState({
      selectedKeyType: '4key',
      keyMappings: { '4key': ['A', 'B'] },
      canonicalPositions: { '4key': [keyAt(ID_A), keyAt(ID_B)] },
      positions: { '4key': [keyAt(ID_A), keyAt(ID_B)] },
    });
    useStatItemStore.setState({ positions: {} });
    useGraphItemStore.setState({ positions: {} });
    useKnobItemStore.setState({ positions: {} });
    useLayerGroupStore.setState({ layerGroups: {} });
    useGridSelectionStore.setState({ selectedElements: [] });
  });

  it('키 삭제는 keys와 keyPositions를 함께 제거하고 즉시 스토어에 반영한다', async () => {
    // base는 eager 반영 전 canonical
    const pre = documentFromStores();
    slotBase = () => pre;
    const applied = await deleteElementById('key', ID_A);

    expect(applied).toBe(true);
    // eager: 스토어에서 이미 제거됨
    expect(useKeyStore.getState().keyMappings['4key']).toEqual(['B']);
    expect(
      useKeyStore.getState().canonicalPositions['4key'].map((p) => p.id),
    ).toEqual([ID_B]);
    expect(api.commitSemanticOps).toHaveBeenCalledWith(
      [{ kind: 'deleteElement', elementType: 'key', id: ID_A }],
      expect.objectContaining({ onEnrolled: expect.any(Function) }),
    );
    expect(api.commitGeneratedPatch).not.toHaveBeenCalled();
  });

  it('삭제 확정 시점에 재정렬돼 있어도 같은 id를 제거한다', async () => {
    slotBase = () => {
      const base = documentFromStores();
      base.keys = { '4key': ['B', 'A'] };
      base.keyPositions = { '4key': [keyAt(ID_B), keyAt(ID_A)] } as never;
      return base;
    };

    await deleteElementById('key', ID_A);

    expect(api.commitSemanticOps).toHaveBeenCalledWith(
      [expect.objectContaining({ id: ID_A })],
      expect.anything(),
    );
  });

  it('단일 삭제가 마지막 그룹 멤버면 로컬 빈 그룹도 정리한다', async () => {
    useKeyStore.setState({
      keyMappings: { '4key': ['A'] },
      canonicalPositions: {
        '4key': [{ ...keyAt(ID_A), groupId: 'group-a' }],
      },
      positions: { '4key': [{ ...keyAt(ID_A), groupId: 'group-a' }] },
    });
    useLayerGroupStore.setState({
      layerGroups: { '4key': [{ id: 'group-a', name: 'Group A' }] },
    });

    await deleteElementById('key', ID_A);

    expect(useLayerGroupStore.getState().layerGroups['4key']).toEqual([]);
  });

  it('확정 시점에 이미 삭제된 대상은 커밋하지 않는다', async () => {
    slotBase = () => {
      const base = documentFromStores();
      base.keys = { '4key': ['B'] };
      base.keyPositions = { '4key': [keyAt(ID_B)] } as never;
      return base;
    };

    await deleteElementById('key', ID_A);

    expect(api.commitSemanticOps).toHaveBeenCalledWith(
      [expect.objectContaining({ id: ID_A })],
      expect.anything(),
    );
  });

  it('복제 배치는 동결 payload를 새 id로 추가한다', async () => {
    const frozen = {
      slot: 'A',
      position: keyAt(ID_A),
    };

    await placeDuplicatedKey(frozen, '4key', 10, 20);

    const op = api.commitSemanticOps.mock.calls[0][0][0];
    expect(op).toMatchObject({
      kind: 'insertFrozenElements',
      mode: '4key',
      groups: [],
      zUpdates: [],
      elements: [{ elementType: 'key', slot: 'A' }],
    });
    const added = op.elements[0].position;
    expect(added?.dx).toBe(10);
    expect(added?.dy).toBe(20);
    expect(added?.id).toBeTruthy();
    expect(added?.id).not.toBe(ID_A);
    // eager 반영
    expect(useKeyStore.getState().keyMappings['4key']).toHaveLength(3);
  });

  it('단일 frozen add는 4타입 exact op와 eager append를 사용한다', async () => {
    const stat = { ...keyAt(ID_A), id: crypto.randomUUID(), statType: 'kps' };
    const graph = {
      ...graphAt(ID_A),
      id: crypto.randomUUID(),
    };
    const knob = {
      ...keyAt(ID_A),
      id: crypto.randomUUID(),
      axisId: '',
      sensitivity: 1,
      reverse: false,
    };

    await addKeyAt('4key', 12, 34);
    await addStatAt('4key', stat as never);
    await addGraphAt('4key', graph);
    await addKnobAt('4key', knob as never);

    const ops = api.commitSemanticOps.mock.calls.map((call) => call[0][0]);
    expect(ops.map((op) => op.kind)).toEqual([
      'insertFrozenElements',
      'insertFrozenElements',
      'insertFrozenElements',
      'insertFrozenElements',
    ]);
    expect(ops.map((op) => op.elements[0].elementType)).toEqual([
      'key',
      'stat',
      'graph',
      'knob',
    ]);
    for (const op of ops) {
      expect(op).toMatchObject({ mode: '4key', groups: [], zUpdates: [] });
    }
    expect(ops[0].elements[0]).toMatchObject({
      elementType: 'key',
      slot: '',
      position: { dx: 12, dy: 34 },
    });
    expect(
      ops.slice(1).every((op) => op.elements[0].position.zIndex == null),
    ).toBe(true);
    expect(useKeyStore.getState().canonicalPositions['4key']).toHaveLength(3);
    expect(useStatItemStore.getState().positions['4key']).toHaveLength(1);
    expect(useGraphItemStore.getState().positions['4key']).toHaveLength(1);
    expect(useKnobItemStore.getState().positions['4key']).toHaveLength(1);
    expect(useGridSelectionStore.getState().selectedElements).toEqual([]);
  });

  it('신규 UUID가 기존 native ID와 충돌하면 eager와 wire를 모두 생략한다', async () => {
    const randomId = vi
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce(
        ID_A as `${string}-${string}-${string}-${string}-${string}`,
      );

    await expect(addKeyAt('4key', 1, 2)).resolves.toBe(false);

    expect(api.commitSemanticOps).not.toHaveBeenCalled();
    expect(useKeyStore.getState().canonicalPositions['4key']).toHaveLength(2);
    randomId.mockRestore();
  });

  it('연속 삽입은 서로 다른 frozen ID를 각각 한 op로 유지한다', async () => {
    const first = addKeyAt('4key', 1, 2);
    const second = addKeyAt('4key', 3, 4);
    await Promise.all([first, second]);

    const ids = api.commitSemanticOps.mock.calls.map(
      (call) => call[0][0].elements[0].position.id,
    );
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(
      useKeyStore
        .getState()
        .canonicalPositions['4key'].slice(-2)
        .map((position) => position.id),
    ).toEqual(ids);
  });

  it('item ghost 복제는 좌표를 반올림하지 않고 동결 z와 새 id를 쓴다', async () => {
    const sourceStat = {
      ...keyAt('synthetic-stat-0'),
      statType: 'kps',
      groupId: 'group-a',
    };
    useLayerGroupStore.setState({
      layerGroups: { '4key': [{ id: 'group-a', name: 'Group A' }] },
    });

    await placeDuplicatedStat('4key', sourceStat as never, 1.25, 2.75, 91);
    await placeDuplicatedGraph(
      '4key',
      graphAt('synthetic-graph-0'),
      3.25,
      4.75,
      92,
    );
    await placeDuplicatedKnob(
      '4key',
      {
        ...keyAt('synthetic-knob-0'),
        axisId: '',
        sensitivity: 1,
        reverse: false,
      } as never,
      5.25,
      6.75,
      93,
    );

    const elements = api.commitSemanticOps.mock.calls.map(
      (call) => call[0][0].elements[0],
    );
    expect(elements.map((element) => element.position)).toMatchObject([
      { dx: 1.25, dy: 2.75, zIndex: 91, groupId: 'group-a' },
      { dx: 3.25, dy: 4.75, zIndex: 92 },
      { dx: 5.25, dy: 6.75, zIndex: 93 },
    ]);
    expect(new Set(elements.map((element) => element.position.id)).size).toBe(
      3,
    );
    expect(
      elements.every(
        (element) => !String(element.position.id).startsWith('synthetic-'),
      ),
    ).toBe(true);
  });

  it('ghost 모드의 유효 그룹만 보존하고 소실 그룹은 제거한다', async () => {
    useLayerGroupStore.setState({
      layerGroups: {
        '4key': [{ id: 'group-a', name: 'Source' }],
        '7key': [{ id: 'group-a', name: 'Target' }],
      },
    });
    const source = {
      ...graphAt('synthetic-graph-0'),
      groupId: 'group-a',
    };

    await placeDuplicatedGraph('7key', source, 1, 2, 3);
    useLayerGroupStore.setState({ layerGroups: { '4key': [] } });
    await placeDuplicatedGraph('4key', source, 4, 5, 6);

    const first = api.commitSemanticOps.mock.calls[0][0][0].elements[0];
    const second = api.commitSemanticOps.mock.calls[1][0][0].elements[0];
    expect(first.position.groupId).toBe('group-a');
    expect(second.position.groupId).toBeUndefined();
  });

  it('z-order는 대상 id들에 단일 트랜잭션으로 새 z를 배정한다', async () => {
    useKeyStore.setState({
      canonicalPositions: {
        '4key': [keyAt(ID_A, 1), keyAt(ID_B, 5)],
      },
      positions: { '4key': [keyAt(ID_A, 1), keyAt(ID_B, 5)] },
    });

    const pre = documentFromStores();
    slotBase = () => pre;
    const applied = await applyZOrderByIds(
      [
        { type: 'key', id: ID_A },
        { type: 'key', id: ID_B },
      ],
      'front',
      [9],
    );

    expect(applied).toBe(2);
    expect(api.commitGeneratedPatch).toHaveBeenCalledOnce();
    const record = generatedPatches[0]?.keyPositions?.['4key'];
    // 외부(9) 포함 max=9, 선택 순서대로 10, 11
    expect(record?.find((p) => p.id === ID_A)?.zIndex).toBe(10);
    expect(record?.find((p) => p.id === ID_B)?.zIndex).toBe(11);
  });

  it('z-order 확정 시점 재정렬에도 id를 따라간다', async () => {
    useKeyStore.setState({
      canonicalPositions: {
        '4key': [keyAt(ID_A, 1), keyAt(ID_B, 5)],
      },
      positions: { '4key': [keyAt(ID_A, 1), keyAt(ID_B, 5)] },
    });
    slotBase = () => {
      const base = documentFromStores();
      base.keyPositions = {
        '4key': [keyAt(ID_B, 5), keyAt(ID_A, 1)],
      } as never;
      return base;
    };

    await applyZOrderByIds([{ type: 'key', id: ID_A }], 'front', []);

    const record = generatedPatches[0]?.keyPositions?.['4key'];
    expect(record?.[1].id).toBe(ID_A);
    expect(record?.[1].zIndex).toBe(6);
    expect(record?.[0].zIndex).toBe(5);
  });

  it('슬롯 재바인딩은 위치 id와 새 slot만 semantic op로 보낸다', async () => {
    const applied = await rebindKeySlotById(ID_A, 'Z');

    expect(applied).toBe(true);
    // eager: 호출 시점 스토어 기준 index 0 (ID_A 위치)
    expect(useKeyStore.getState().keyMappings['4key']).toEqual(['Z', 'B']);
    expect(api.commitSemanticOps).toHaveBeenCalledWith(
      [{ kind: 'setKeySlot', id: ID_A, slot: 'Z' }],
      expect.objectContaining({ onEnrolled: expect.any(Function) }),
    );
    expect(api.commitGeneratedPatch).not.toHaveBeenCalled();
  });

  it('다중 정산은 기하만 실어 base의 무관 필드 재작성을 보존한다', async () => {
    // 호출 시점 스토어: 드래그 결과 dx=50. base(슬롯 시점)에는 그 사이
    // 배타 mutation이 재작성한 counter preset(Q)이 있다
    useKeyStore.setState({
      canonicalPositions: {
        '4key': [{ ...keyAt(ID_A), dx: 50 }, keyAt(ID_B)],
      },
      positions: { '4key': [{ ...keyAt(ID_A), dx: 50 }, keyAt(ID_B)] },
    });
    slotBase = () => {
      const base = documentFromStores();
      base.keyPositions = {
        '4key': [
          { ...keyAt(ID_A), dx: 0, inactiveImage: 'rewritten-by-mutation.png' },
          keyAt(ID_B),
        ],
      } as never;
      return base;
    };

    const applied = await commitSelectedGeometryByIds(
      [{ type: 'key', id: ID_A }],
      'gesture-sync',
    );

    expect(applied).toBe(1);
    expect(api.commitGeneratedPatch.mock.calls[0][1]).toMatchObject({
      gestureId: 'gesture-sync',
    });
    const record = generatedPatches[0]?.keyPositions?.['4key'];
    // 기하는 의도값, mutation이 재작성한 필드는 base 값 유지
    expect(record?.[0].dx).toBe(50);
    expect(record?.[0].inactiveImage).toBe('rewritten-by-mutation.png');
  });

  it('단일 축 기하는 슬롯 최신 base의 나머지 bounds를 보존한다', async () => {
    const base = documentFromStores();
    base.keyPositions = {
      '4key': [
        { ...keyAt(ID_A), dx: 10, dy: 77, width: 123, height: 91 },
        keyAt(ID_B),
      ],
    } as never;
    slotBase = () => base;

    await commitElementGeometryById('key', ID_A, { dx: 50 });

    const ops = api.commitGeneratedSemanticOps.mock.calls[0][0](base);
    expect(ops).toEqual([
      {
        kind: 'setBounds',
        elementType: 'key',
        id: ID_A,
        bounds: { dx: 50, dy: 77, width: 123, height: 91 },
      },
    ]);
  });

  it('statType은 stat 안정 ID에 exact one-leaf op를 보낸다', async () => {
    useStatItemStore.setState({
      positions: {
        '4key': [{ ...keyAt(ID_A), statType: 'kps' }] as never,
      },
    });

    await patchStatTypeById(ID_A, { statType: 'kpsMax' });

    expect(api.commitSemanticOps).toHaveBeenCalledWith(
      [
        {
          kind: 'patchElement',
          elementType: 'stat',
          id: ID_A,
          patch: { statType: 'kpsMax' },
        },
      ],
      expect.objectContaining({ onEnrolled: expect.any(Function) }),
    );
    expect(useStatItemStore.getState().positions['4key'][0].statType).toBe(
      'kpsMax',
    );
  });

  it('단일 축 기하는 호출 뒤 patch 변조와 무관하게 최초 intent를 유지한다', async () => {
    const patch = { dx: 50 } as { dx: number; dy?: number };
    let capturedGenerate:
      | ((base: EditorDocumentV1) => readonly unknown[] | null)
      | null = null;
    api.commitGeneratedSemanticOps.mockImplementationOnce(
      async (generate, meta) => {
        capturedGenerate = generate;
        meta?.onEnrolled?.();
        const ops = generate(documentFromStores());
        return {
          document: documentFromStores(),
          opResults: ops!.map((op: { bounds: unknown }) => ({
            status: 'applied',
            bounds: op.bounds,
          })),
        };
      },
    );

    const committed = commitElementGeometryById('key', ID_A, patch);
    patch.dx = 999;
    patch.dy = 777;
    await committed;

    const ops = capturedGenerate!(documentFromStores()) as Array<{
      bounds: Record<string, number>;
    }>;
    expect(ops[0].bounds.dx).toBe(50);
    expect(ops[0].bounds.dy).not.toBe(777);
  });

  it('단일 축 기하 대상이 슬롯 전에 사라지면 eager를 복원한다', async () => {
    const before = structuredClone(
      useKeyStore.getState().canonicalPositions['4key'][0],
    );
    const missing = documentFromStores();
    missing.keys = { '4key': ['B'] };
    missing.keyPositions = { '4key': [keyAt(ID_B)] } as never;
    slotBase = () => missing;

    await expect(
      commitElementGeometryById('key', ID_A, { width: 90 }),
    ).resolves.toBe(false);

    expect(useKeyStore.getState().canonicalPositions['4key'][0].width).toBe(
      before.width,
    );
  });

  it('단일 축 기하는 편입 전 실패만 CAS 복원한다', async () => {
    api.commitGeneratedSemanticOps.mockRejectedValueOnce(
      new Error('start failed'),
    );
    const before = useKeyStore.getState().canonicalPositions['4key'][0].height;

    await expect(
      commitElementGeometryById('key', ID_A, { height: 80 }),
    ).rejects.toThrow('start failed');

    expect(useKeyStore.getState().canonicalPositions['4key'][0].height).toBe(
      before,
    );
  });

  it('리사이즈 정산은 크기 필드까지 의도에 싣는다', async () => {
    useKeyStore.setState({
      canonicalPositions: {
        '4key': [{ ...keyAt(ID_A), dx: 5, width: 90, height: 80 }],
      },
      positions: {
        '4key': [{ ...keyAt(ID_A), dx: 5, width: 90, height: 80 }],
      },
    });
    const pre = documentFromStores();
    pre.keyPositions = {
      '4key': [{ ...keyAt(ID_A), dx: 0, width: 60, height: 60 }],
    } as never;
    slotBase = () => pre;

    await commitSelectedGeometryByIds([{ type: 'key', id: ID_A }], undefined, [
      'dx',
      'dy',
      'width',
      'height',
    ]);

    const record = generatedPatches[0]?.keyPositions?.['4key'];
    expect(record?.[0]).toMatchObject({ dx: 5, width: 90, height: 80 });
  });

  it('이동 정산은 크기 필드를 싣지 않는다', async () => {
    useKeyStore.setState({
      canonicalPositions: {
        '4key': [{ ...keyAt(ID_A), dx: 5, width: 90 }],
      },
      positions: { '4key': [{ ...keyAt(ID_A), dx: 5, width: 90 }] },
    });
    const pre = documentFromStores();
    // 병행 크기 변경이 base에 정산된 상황
    pre.keyPositions = {
      '4key': [{ ...keyAt(ID_A), dx: 0, width: 120 }],
    } as never;
    slotBase = () => pre;

    await commitSelectedGeometryByIds([{ type: 'key', id: ID_A }]);

    const record = generatedPatches[0]?.keyPositions?.['4key'];
    expect(record?.[0].dx).toBe(5);
    // 병행 크기 변경 보존
    expect(record?.[0].width).toBe(120);
  });

  it('배치 정렬은 stable ID 전 대상을 N setBounds로 한 번에 생성한다', async () => {
    const stat = { ...keyAt(ID_B), dx: 50, dy: 10, width: 20, height: 30 };
    useKeyStore.setState({
      canonicalPositions: {
        '4key': [{ ...keyAt(ID_A), dx: 10, dy: 0, width: 10, height: 20 }],
      },
      positions: {
        '4key': [{ ...keyAt(ID_A), dx: 10, dy: 0, width: 10, height: 20 }],
      },
    });
    useStatItemStore.setState({ positions: { '4key': [stat as never] } });
    api.lastAck = documentFromStores();

    await commitBatchGeometryByIds({
      mode: '4key',
      targets: [
        { type: 'key', id: ID_A },
        { type: 'stat', id: ID_B },
      ],
      operation: { kind: 'align', direction: 'right' },
    });

    expect(api.commitGeneratedSemanticOps).toHaveBeenCalledOnce();
    const generate = api.commitGeneratedSemanticOps.mock.calls[0][0];
    expect(generate(documentFromStores())).toEqual([
      {
        kind: 'setBounds',
        elementType: 'key',
        id: ID_A,
        bounds: { dx: 60, dy: 0, width: 10, height: 20 },
      },
      {
        kind: 'setBounds',
        elementType: 'stat',
        id: ID_B,
        bounds: { dx: 50, dy: 10, width: 20, height: 30 },
      },
    ]);
  });

  it('배치 geometry는 slot 최신 base에서 전체 계획을 다시 계산한다', async () => {
    useKeyStore.setState({
      canonicalPositions: {
        '4key': [
          { ...keyAt(ID_A), dx: 0, width: 10 },
          { ...keyAt(ID_B), dx: 30, width: 10 },
        ],
      },
      positions: {
        '4key': [
          { ...keyAt(ID_A), dx: 0, width: 10 },
          { ...keyAt(ID_B), dx: 30, width: 10 },
        ],
      },
    });
    api.lastAck = documentFromStores();
    const latest = documentFromStores();
    latest.keyPositions = {
      '4key': [
        { ...keyAt(ID_B), dx: 80, width: 20 },
        { ...keyAt(ID_A), dx: 10, width: 10 },
      ],
    } as never;
    slotBase = () => latest;

    await commitBatchGeometryByIds({
      mode: '4key',
      targets: [
        { type: 'key', id: ID_A },
        { type: 'key', id: ID_B },
      ],
      operation: { kind: 'align', direction: 'right' },
    });

    const generate = api.commitGeneratedSemanticOps.mock.calls[0][0];
    expect(generate(latest)).toEqual([
      expect.objectContaining({
        id: ID_A,
        bounds: expect.objectContaining({ dx: 90 }),
      }),
      expect.objectContaining({
        id: ID_B,
        bounds: expect.objectContaining({ dx: 80 }),
      }),
    ]);
  });

  it('배치 geometry eager는 lastAck가 아니라 최신 canonical store를 기준으로 한다', async () => {
    useKeyStore.setState({
      canonicalPositions: {
        '4key': [
          { ...keyAt(ID_A), dx: 10, width: 10 },
          { ...keyAt(ID_B), dx: 80, width: 20 },
        ],
      },
      positions: {
        '4key': [
          { ...keyAt(ID_A), dx: 10, width: 10 },
          { ...keyAt(ID_B), dx: 80, width: 20 },
        ],
      },
    });
    const staleAck = documentFromStores();
    staleAck.keyPositions = {
      '4key': [
        { ...keyAt(ID_A), dx: 0, width: 10 },
        { ...keyAt(ID_B), dx: 30, width: 10 },
      ],
    } as never;
    api.lastAck = staleAck;

    await commitBatchGeometryByIds({
      mode: '4key',
      targets: [
        { type: 'key', id: ID_A },
        { type: 'key', id: ID_B },
      ],
      operation: { kind: 'align', direction: 'right' },
    });

    expect(useKeyStore.getState().canonicalPositions['4key']).toEqual([
      expect.objectContaining({ id: ID_A, dx: 90 }),
      expect.objectContaining({ id: ID_B, dx: 80 }),
    ]);
  });

  it('배치 geometry 대상 하나가 소실되면 전체 null이고 eager를 복원한다', async () => {
    useKeyStore.setState({
      canonicalPositions: {
        '4key': [
          { ...keyAt(ID_A), dx: 0 },
          { ...keyAt(ID_B), dx: 30 },
        ],
      },
      positions: {
        '4key': [
          { ...keyAt(ID_A), dx: 0 },
          { ...keyAt(ID_B), dx: 30 },
        ],
      },
    });
    api.lastAck = documentFromStores();
    slotBase = () => {
      const base = documentFromStores();
      base.keyPositions = { '4key': [keyAt(ID_A)] } as never;
      return base;
    };

    await expect(
      commitBatchGeometryByIds({
        mode: '4key',
        targets: [
          { type: 'key', id: ID_A },
          { type: 'key', id: ID_B },
        ],
        operation: { kind: 'align', direction: 'right' },
      }),
    ).resolves.toBe(false);

    expect(useKeyStore.getState().canonicalPositions['4key']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: ID_A, dx: 0 }),
        expect.objectContaining({ id: ID_B, dx: 30 }),
      ]),
    );
  });

  it('슬롯 base가 이미 원하는 spacing이면 N noChange 의도로 정산하고 eager를 되돌리지 않는다', async () => {
    useKeyStore.setState({
      canonicalPositions: {
        '4key': [
          { ...keyAt(ID_A), dx: 0, width: 10 },
          { ...keyAt(ID_B), dx: 30, width: 10 },
        ],
      },
      positions: {
        '4key': [
          { ...keyAt(ID_A), dx: 0, width: 10 },
          { ...keyAt(ID_B), dx: 30, width: 10 },
        ],
      },
    });
    slotBase = () => {
      const base = documentFromStores();
      base.keyPositions = {
        '4key': [
          { ...keyAt(ID_A), dx: 0, width: 10 },
          { ...keyAt(ID_B), dx: 15, width: 10 },
        ],
      } as never;
      return base;
    };

    await expect(
      commitBatchGeometryByIds({
        mode: '4key',
        targets: [
          { type: 'key', id: ID_A },
          { type: 'key', id: ID_B },
        ],
        operation: { kind: 'spacing', spacing: 5 },
      }),
    ).resolves.toBe(true);

    const generate = api.commitGeneratedSemanticOps.mock.calls[0][0];
    expect(generate(slotBase())).toEqual([
      expect.objectContaining({
        id: ID_A,
        bounds: expect.objectContaining({ dx: 0 }),
      }),
      expect.objectContaining({
        id: ID_B,
        bounds: expect.objectContaining({ dx: 15 }),
      }),
    ]);
    expect(useKeyStore.getState().canonicalPositions['4key']).toEqual([
      expect.objectContaining({ id: ID_A, dx: 0 }),
      expect.objectContaining({ id: ID_B, dx: 15 }),
    ]);
  });

  it('호출 시점에 배치 geometry 대상이 없으면 eager나 슬롯 커밋을 시작하지 않는다', async () => {
    const before = structuredClone(
      useKeyStore.getState().canonicalPositions['4key'],
    );

    await expect(
      commitBatchGeometryByIds({
        mode: '4key',
        targets: [
          { type: 'key', id: ID_A },
          { type: 'key', id: '33333333-3333-4333-8333-333333333333' },
        ],
        operation: { kind: 'align', direction: 'left' },
      }),
    ).resolves.toBe(false);

    expect(api.commitGeneratedSemanticOps).not.toHaveBeenCalled();
    expect(useKeyStore.getState().canonicalPositions['4key']).toEqual(before);
  });

  it('호출 시점 spacing이 이미 정확하면 슬롯 커밋 없이 false를 반환한다', async () => {
    useKeyStore.setState({
      canonicalPositions: {
        '4key': [
          { ...keyAt(ID_A), dx: 0, width: 10 },
          { ...keyAt(ID_B), dx: 15, width: 10 },
        ],
      },
      positions: {
        '4key': [
          { ...keyAt(ID_A), dx: 0, width: 10 },
          { ...keyAt(ID_B), dx: 15, width: 10 },
        ],
      },
    });
    const before = structuredClone(
      useKeyStore.getState().canonicalPositions['4key'],
    );

    await expect(
      commitBatchGeometryByIds({
        mode: '4key',
        targets: [
          { type: 'key', id: ID_A },
          { type: 'key', id: ID_B },
        ],
        operation: { kind: 'spacing', spacing: 5 },
      }),
    ).resolves.toBe(false);

    expect(api.commitGeneratedSemanticOps).not.toHaveBeenCalled();
    expect(useKeyStore.getState().canonicalPositions['4key']).toEqual(before);
  });

  it('배치 geometry 편입 전 실패는 전체 eager를 CAS 복원한다', async () => {
    useKeyStore.setState({
      canonicalPositions: {
        '4key': [
          { ...keyAt(ID_A), dx: 0, width: 10 },
          { ...keyAt(ID_B), dx: 30, width: 10 },
        ],
      },
      positions: {
        '4key': [
          { ...keyAt(ID_A), dx: 0, width: 10 },
          { ...keyAt(ID_B), dx: 30, width: 10 },
        ],
      },
    });
    const before = structuredClone(
      useKeyStore.getState().canonicalPositions['4key'],
    );
    api.commitGeneratedSemanticOps.mockRejectedValueOnce(
      new Error('preflight failed'),
    );

    await expect(
      commitBatchGeometryByIds({
        mode: '4key',
        targets: [
          { type: 'key', id: ID_A },
          { type: 'key', id: ID_B },
        ],
        operation: { kind: 'align', direction: 'right' },
      }),
    ).rejects.toThrow('preflight failed');

    expect(useKeyStore.getState().canonicalPositions['4key']).toEqual(before);
  });

  it('그룹 visibility는 slot 최신 membership만 적용하고 떠난 대상의 외부 hidden을 보존한다', async () => {
    useKeyStore.setState({
      canonicalPositions: {
        '4key': [
          { ...keyAt(ID_A), groupId: 'group-a', hidden: false },
          { ...keyAt(ID_B), hidden: false },
        ],
      },
      positions: {
        '4key': [
          { ...keyAt(ID_A), groupId: 'group-a', hidden: false },
          { ...keyAt(ID_B), hidden: false },
        ],
      },
    });
    api.commitGeneratedSemanticOps.mockImplementationOnce(async (generate) => {
      const latest = documentFromStores();
      latest.keyPositions = {
        '4key': [
          { ...keyAt(ID_A), hidden: true },
          { ...keyAt(ID_B), groupId: 'group-a', hidden: false },
        ],
      } as never;
      useKeyStore.setState({
        canonicalPositions: structuredClone(latest.keyPositions),
        positions: structuredClone(latest.keyPositions),
      });

      const ops = generate(latest);
      expect(
        useKeyStore.getState().canonicalPositions['4key'][0],
      ).toMatchObject({ id: ID_A, hidden: true });
      expect(ops).toEqual([
        {
          kind: 'patchElement',
          elementType: 'key',
          id: ID_B,
          patch: { hidden: true },
        },
      ]);
      return {
        document: latest,
        opResults: [{ status: 'applied' }],
      } as never;
    });

    await expect(setLayerGroupHidden('4key', 'group-a', true)).resolves.toBe(
      true,
    );
  });

  it('stable 그룹 4타입은 N patchElement를 한 generated commit으로 보낸다', async () => {
    useKeyStore.setState({
      canonicalPositions: {
        '4key': [{ ...keyAt(ID_A), groupId: 'group-a', hidden: false }],
      },
      positions: {
        '4key': [{ ...keyAt(ID_A), groupId: 'group-a', hidden: false }],
      },
    });
    useStatItemStore.setState({
      positions: {
        '4key': [
          {
            ...keyAt('33333333-3333-4333-8333-333333333333'),
            groupId: 'group-a',
            hidden: false,
          } as never,
        ],
      },
    });
    useGraphItemStore.setState({
      positions: {
        '4key': [
          graphAt('44444444-4444-4444-8444-444444444444', {
            groupId: 'group-a',
            hidden: false,
          }),
        ],
      },
    });
    useKnobItemStore.setState({
      positions: {
        '4key': [
          {
            ...keyAt('55555555-5555-4555-8555-555555555555'),
            groupId: 'group-a',
            hidden: false,
          } as never,
        ],
      },
    });

    await setLayerGroupHidden('4key', 'group-a', true);

    expect(api.commitGeneratedSemanticOps).toHaveBeenCalledOnce();
    const generate = api.commitGeneratedSemanticOps.mock.calls[0][0];
    expect(generate(documentFromStores())).toEqual([
      expect.objectContaining({ elementType: 'key', id: ID_A }),
      expect.objectContaining({
        elementType: 'stat',
        id: '33333333-3333-4333-8333-333333333333',
      }),
      expect.objectContaining({
        elementType: 'graph',
        id: '44444444-4444-4444-8444-444444444444',
      }),
      expect.objectContaining({
        elementType: 'knob',
        id: '55555555-5555-4555-8555-555555555555',
      }),
    ]);
  });

  it('stable 그룹 helper는 slot synthetic 멤버를 만나면 whole fail-closed한다', async () => {
    const stable = { ...keyAt(ID_A), groupId: 'group-a', hidden: false };
    const synthetic = { ...keyAt(ID_B), groupId: 'group-a', hidden: false };
    delete (synthetic as { id?: string }).id;
    useKeyStore.setState({
      canonicalPositions: { '4key': [stable, synthetic] } as never,
      positions: { '4key': [stable, synthetic] } as never,
    });
    const before = documentFromStores();
    api.commitGeneratedSemanticOps.mockImplementationOnce(async (generate) => {
      expect(generate(before)).toBeNull();
      return null;
    });

    await expect(setLayerGroupHidden('4key', 'group-a', true)).resolves.toBe(
      false,
    );

    expect(api.commitGeneratedSemanticOps).toHaveBeenCalledOnce();
    expect(useKeyStore.getState().canonicalPositions['4key'][0].hidden).toBe(
      false,
    );
    expect(useKeyStore.getState().canonicalPositions['4key'][1].hidden).toBe(
      false,
    );
  });

  it('그룹 visibility는 호출 시점 empty여도 slot 신규 멤버를 적용한다', async () => {
    useKeyStore.setState({
      canonicalPositions: { '4key': [keyAt(ID_A)] },
      positions: { '4key': [keyAt(ID_A)] },
    });
    const latest = documentFromStores();
    latest.keyPositions = {
      '4key': [{ ...keyAt(ID_A), groupId: 'group-a', hidden: false }],
    } as never;
    slotBase = () => latest;

    await expect(setLayerGroupHidden('4key', 'group-a', true)).resolves.toBe(
      true,
    );

    const generate = api.commitGeneratedSemanticOps.mock.calls[0][0];
    expect(generate(latest)).toEqual([
      expect.objectContaining({ id: ID_A, patch: { hidden: true } }),
    ]);
  });

  it('그룹 visibility preflight 실패는 lastAck hidden을 보존하고 old-before로 되돌리지 않는다', async () => {
    useKeyStore.setState({
      canonicalPositions: {
        '4key': [{ ...keyAt(ID_A), groupId: 'group-a', hidden: false }],
      },
      positions: {
        '4key': [{ ...keyAt(ID_A), groupId: 'group-a', hidden: false }],
      },
    });
    const latest = documentFromStores();
    latest.keyPositions = {
      '4key': [{ ...keyAt(ID_A), groupId: 'group-a', hidden: true }],
    } as never;
    api.lastAck = latest;
    api.commitGeneratedSemanticOps.mockRejectedValueOnce(
      new Error('preflight stale'),
    );

    await expect(setLayerGroupHidden('4key', 'group-a', true)).rejects.toThrow(
      'preflight stale',
    );

    expect(useKeyStore.getState().canonicalPositions['4key'][0].hidden).toBe(
      true,
    );
  });

  it('synthetic group legacy는 idless 멤버도 즉시 eager 적용한다', async () => {
    const idless = { ...keyAt(ID_A), groupId: 'group-a', hidden: false };
    delete (idless as { id?: string }).id;
    useKeyStore.setState({
      canonicalPositions: { '4key': [idless] } as never,
      positions: { '4key': [idless] } as never,
    });
    let resolveCommit!: (value: EditorDocumentV1) => void;
    api.commitGeneratedPatch.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCommit = resolve;
      }),
    );

    const pending = setLayerGroupHiddenLegacy('4key', 'group-a', true);
    await vi.waitFor(() =>
      expect(useKeyStore.getState().canonicalPositions['4key'][0].hidden).toBe(
        true,
      ),
    );
    resolveCommit(documentFromStores());
    await pending;
  });

  it('synthetic group legacy satisfied는 latest desired를 local store에 보존한다', async () => {
    const idless = { ...keyAt(ID_A), groupId: 'group-a', hidden: false };
    delete (idless as { id?: string }).id;
    useKeyStore.setState({
      canonicalPositions: { '4key': [idless] } as never,
      positions: { '4key': [idless] } as never,
    });
    api.commitGeneratedPatch.mockImplementationOnce(async (generate) => {
      const latest = documentFromStores();
      latest.keyPositions = {
        '4key': [{ ...idless, hidden: true }],
      } as never;
      const patch = generate(latest);
      expect(patch).toBeNull();
      return latest;
    });

    await expect(
      setLayerGroupHiddenLegacy('4key', 'group-a', true),
    ).resolves.toBe(true);

    expect(useKeyStore.getState().canonicalPositions['4key'][0].hidden).toBe(
      true,
    );
  });

  it('다중 정산 대상이 전부 사라졌으면 커밋하지 않는다', async () => {
    slotBase = () => {
      const base = documentFromStores();
      base.keyPositions = { '4key': [keyAt(ID_B)] } as never;
      return base;
    };

    const applied = await commitSelectedGeometryByIds([
      { type: 'key', id: ID_A },
    ]);

    expect(applied).toBe(0);
    expect(generatedPatches).toEqual([null]);
  });

  it('단일 bounds op의 편입 전 실패는 4필드를 CAS 복원한다', async () => {
    api.commitSemanticOps.mockRejectedValue(new Error('start failed'));
    const before = structuredClone(
      useKeyStore.getState().canonicalPositions['4key'][0],
    );

    await expect(
      commitSingleElementBoundsById('key', ID_A, {
        dx: 50,
        dy: 60,
        width: 90,
        height: 80,
      }),
    ).rejects.toThrow('start failed');

    expect(useKeyStore.getState().canonicalPositions['4key'][0]).toMatchObject({
      dx: before.dx,
      dy: before.dy,
      width: before.width,
      height: before.height,
    });
  });

  it('단일 bounds op는 wire에 안정 id와 gesture를 싣는다', async () => {
    const committed = await commitSingleElementBoundsById(
      'key',
      ID_A,
      { dx: 50, dy: 60, width: 90, height: 80 },
      'resize-gesture',
    );

    expect(committed).toBe(true);
    expect(api.commitSemanticOps).toHaveBeenCalledWith(
      [
        {
          kind: 'setBounds',
          elementType: 'key',
          id: ID_A,
          bounds: { dx: 50, dy: 60, width: 90, height: 80 },
        },
      ],
      expect.objectContaining({ gestureId: 'resize-gesture' }),
    );
    expect(useKeyStore.getState().canonicalPositions['4key'][0]).toMatchObject({
      dx: 50,
      dy: 60,
      width: 90,
      height: 80,
    });
  });

  it('단일 bounds op의 targetMissing은 canonical 동기화 결과를 유지한다', async () => {
    api.commitSemanticOps.mockImplementationOnce(async (_ops, meta) => {
      meta?.onEnrolled?.();
      useKeyStore.setState({
        canonicalPositions: { '4key': [keyAt(ID_B)] },
        positions: { '4key': [keyAt(ID_B)] },
      });
      return {
        document: documentFromStores(),
        opResults: [{ status: 'targetMissing' }],
      };
    });

    await expect(
      commitSingleElementBoundsById('key', ID_A, {
        dx: 50,
        dy: 60,
        width: 90,
        height: 80,
      }),
    ).resolves.toBe(false);

    expect(useKeyStore.getState().canonicalPositions['4key']).toEqual([
      keyAt(ID_B),
    ]);
  });

  it('그룹 bounds는 다중 semantic op 한 요청으로 정산한다', async () => {
    const committed = await commitElementBoundsById(
      new Map([
        [
          'key',
          new Map([
            [ID_A, { dx: 50, dy: 60, width: 90, height: 80 }],
            [ID_B, { dx: 70, dy: 80, width: 100, height: 110 }],
          ]),
        ],
      ]),
    );

    expect(committed).toBe(true);
    expect(api.commitSemanticOps).toHaveBeenCalledOnce();
    expect(api.commitSemanticOps.mock.calls[0][0]).toEqual([
      {
        kind: 'setBounds',
        elementType: 'key',
        id: ID_A,
        bounds: { dx: 50, dy: 60, width: 90, height: 80 },
      },
      {
        kind: 'setBounds',
        elementType: 'key',
        id: ID_B,
        bounds: { dx: 70, dy: 80, width: 100, height: 110 },
      },
    ]);
    expect(api.commitGeneratedPatch).not.toHaveBeenCalled();
  });

  it('그룹 bounds는 두 대상을 한 gesture 의도로 함께 정산한다', async () => {
    const committed = await commitElementBoundsById(
      new Map([
        [
          'key',
          new Map([
            [ID_A, { dx: 50, dy: 60, width: 90, height: 80 }],
            [ID_B, { dx: 70, dy: 80, width: 100, height: 110 }],
          ]),
        ],
      ]),
      'group-resize-gesture',
    );

    expect(committed).toBe(true);
    expect(api.commitSemanticOps).toHaveBeenCalledOnce();
    expect(api.commitSemanticOps.mock.calls[0][1]).toMatchObject({
      gestureId: 'group-resize-gesture',
    });
    expect(useKeyStore.getState().canonicalPositions['4key']).toEqual([
      expect.objectContaining({ id: ID_A, dx: 50, width: 90 }),
      expect.objectContaining({ id: ID_B, dx: 70, width: 100 }),
    ]);
  });

  it('그룹 bounds의 편입 전 실패는 모든 eager 필드를 CAS 복원한다', async () => {
    api.commitSemanticOps.mockRejectedValueOnce(new Error('start failed'));
    const before = structuredClone(
      useKeyStore.getState().canonicalPositions['4key'],
    );

    await expect(
      commitElementBoundsById(
        new Map([
          [
            'key',
            new Map([
              [ID_A, { dx: 50, dy: 60, width: 90, height: 80 }],
              [ID_B, { dx: 70, dy: 80, width: 100, height: 110 }],
            ]),
          ],
        ]),
      ),
    ).rejects.toThrow('start failed');

    expect(useKeyStore.getState().canonicalPositions['4key']).toMatchObject(
      before,
    );
  });

  it('그룹 bounds 대기 중 일부 대상이 사라지면 생존 대상만 저장한다', async () => {
    api.commitSemanticOps.mockImplementationOnce(async (ops, meta) => {
      meta?.onEnrolled?.();
      const surviving = { ...keyAt(ID_B), ...ops[1].bounds };
      useKeyStore.setState({
        keyMappings: { '4key': ['B'] },
        canonicalPositions: { '4key': [surviving] },
        positions: { '4key': [surviving] },
      });
      return {
        document: documentFromStores(),
        opResults: [
          { status: 'targetMissing' },
          { status: 'applied', bounds: ops[1].bounds },
        ],
      };
    });

    const committed = await commitElementBoundsById(
      new Map([
        [
          'key',
          new Map([
            [ID_A, { dx: 50, dy: 60, width: 90, height: 80 }],
            [ID_B, { dx: 70, dy: 80, width: 100, height: 110 }],
          ]),
        ],
      ]),
    );

    expect(committed).toBe(true);
    expect(useKeyStore.getState().canonicalPositions['4key']).toEqual([
      expect.objectContaining({ id: ID_B, dx: 70 }),
    ]);
    expect(
      useKeyStore
        .getState()
        .canonicalPositions['4key'].some(({ id }) => id === ID_A),
    ).toBe(false);
  });

  it('그룹 bounds 대상이 전부 사라지면 false로 정산하고 부활시키지 않는다', async () => {
    api.commitSemanticOps.mockImplementationOnce(async (_ops, meta) => {
      meta?.onEnrolled?.();
      useKeyStore.setState({
        keyMappings: { '4key': [] },
        canonicalPositions: { '4key': [] },
        positions: { '4key': [] },
      });
      return {
        document: documentFromStores(),
        opResults: [{ status: 'targetMissing' }, { status: 'targetMissing' }],
      };
    });

    const committed = await commitElementBoundsById(
      new Map([
        [
          'key',
          new Map([
            [ID_A, { dx: 50, dy: 60, width: 90, height: 80 }],
            [ID_B, { dx: 70, dy: 80, width: 100, height: 110 }],
          ]),
        ],
      ]),
    );

    expect(committed).toBe(false);
    expect(useKeyStore.getState().canonicalPositions['4key']).toEqual([]);
  });

  it('삭제의 편입 전 실패는 로컬 pair를 복원한다', async () => {
    api.commitSemanticOps.mockRejectedValue(new Error('start failed'));

    await expect(deleteElementById('key', ID_A)).rejects.toThrow(
      'start failed',
    );

    expect(useKeyStore.getState().keyMappings['4key']).toEqual(['A', 'B']);
    expect(
      useKeyStore.getState().canonicalPositions['4key'].map((p) => p.id),
    ).toEqual([ID_A, ID_B]);
  });

  it('삭제의 편입 전 실패는 eager로 정리한 빈 그룹도 복원한다', async () => {
    useKeyStore.setState({
      keyMappings: { '4key': ['A'] },
      canonicalPositions: {
        '4key': [{ ...keyAt(ID_A), groupId: 'group-a' }],
      },
      positions: { '4key': [{ ...keyAt(ID_A), groupId: 'group-a' }] },
    });
    useLayerGroupStore.setState({
      layerGroups: { '4key': [{ id: 'group-a', name: 'Group A' }] },
    });
    api.commitSemanticOps.mockRejectedValueOnce(new Error('start failed'));

    await expect(deleteElementById('key', ID_A)).rejects.toThrow(
      'start failed',
    );

    expect(useLayerGroupStore.getState().layerGroups['4key']).toEqual([
      { id: 'group-a', name: 'Group A' },
    ]);
  });

  it('그룹 복원은 큐 대기 중 추가된 무관 그룹을 보존한다', async () => {
    useKeyStore.setState({
      keyMappings: { '4key': ['A'] },
      canonicalPositions: {
        '4key': [{ ...keyAt(ID_A), groupId: 'group-a' }],
      },
      positions: { '4key': [{ ...keyAt(ID_A), groupId: 'group-a' }] },
    });
    useLayerGroupStore.setState({
      layerGroups: { '4key': [{ id: 'group-a', name: 'Group A' }] },
    });
    api.commitSemanticOps.mockImplementationOnce(async () => {
      useLayerGroupStore.getState().setLayerGroups({
        '4key': [{ id: 'group-b', name: 'Group B' }],
      });
      throw new Error('start failed');
    });

    await expect(deleteElementById('key', ID_A)).rejects.toThrow(
      'start failed',
    );

    expect(useLayerGroupStore.getState().layerGroups['4key']).toEqual([
      { id: 'group-a', name: 'Group A' },
      { id: 'group-b', name: 'Group B' },
    ]);
  });

  it('편입 전 외부 canonical에서 이미 삭제된 대상은 rollback으로 부활시키지 않는다', async () => {
    api.commitSemanticOps.mockImplementationOnce(async () => {
      const canonical = documentFromStores();
      canonical.keys = { '4key': ['B'] };
      canonical.keyPositions = { '4key': [keyAt(ID_B)] } as never;
      api.lastAck = canonical;
      useKeyStore.setState({
        keyMappings: canonical.keys,
        canonicalPositions: canonical.keyPositions,
        positions: canonical.keyPositions,
      });
      throw new Error('start failed');
    });

    await expect(deleteElementById('key', ID_A)).rejects.toThrow(
      'start failed',
    );

    expect(useKeyStore.getState().keyMappings['4key']).toEqual(['B']);
    expect(
      useKeyStore
        .getState()
        .canonicalPositions['4key'].map((position) => position.id),
    ).toEqual([ID_B]);
  });

  it('외부 canonical이 같은 ID를 다시 넣으면 옛 그룹 정의를 복원하지 않는다', async () => {
    useKeyStore.setState({
      keyMappings: { '4key': ['A'] },
      canonicalPositions: {
        '4key': [{ ...keyAt(ID_A), groupId: 'group-a' }],
      },
      positions: { '4key': [{ ...keyAt(ID_A), groupId: 'group-a' }] },
    });
    useLayerGroupStore.setState({
      layerGroups: { '4key': [{ id: 'group-a', name: 'Group A' }] },
    });
    api.commitSemanticOps.mockImplementationOnce(async () => {
      const restored = keyAt(ID_A);
      const canonical = documentFromStores();
      canonical.keys = { '4key': ['A'] };
      canonical.keyPositions = { '4key': [restored] } as never;
      canonical.layerGroups = { '4key': [] };
      api.lastAck = canonical;
      useKeyStore.setState({
        keyMappings: canonical.keys,
        canonicalPositions: canonical.keyPositions,
        positions: canonical.keyPositions,
      });
      useLayerGroupStore.setState({ layerGroups: { '4key': [] } });
      throw new Error('start failed');
    });

    await expect(deleteElementById('key', ID_A)).rejects.toThrow(
      'start failed',
    );

    expect(useKeyStore.getState().canonicalPositions['4key']).toEqual([
      keyAt(ID_A),
    ]);
    expect(useLayerGroupStore.getState().layerGroups['4key']).toEqual([]);
  });

  it('복제의 편입 전 실패는 추가한 pair를 제거한다', async () => {
    api.commitSemanticOps.mockRejectedValue(new Error('start failed'));

    await expect(
      placeDuplicatedKey({ slot: 'A', position: keyAt(ID_A) }, '4key', 1, 2),
    ).rejects.toThrow('start failed');

    expect(useKeyStore.getState().keyMappings['4key']).toEqual(['A', 'B']);
    expect(useKeyStore.getState().canonicalPositions['4key']).toHaveLength(2);
  });

  it('삽입 편입 전 실패라도 lastAck가 같은 ID를 소유하면 eager를 제거하지 않는다', async () => {
    api.commitSemanticOps.mockImplementationOnce(async (ops) => {
      const element = ops[0].elements[0];
      const canonical = documentFromStores();
      canonical.keys = { '4key': ['A', 'B', ''] };
      canonical.keyPositions = {
        '4key': [keyAt(ID_A), keyAt(ID_B), structuredClone(element.position)],
      } as never;
      api.lastAck = canonical;
      throw new Error('start failed');
    });

    await expect(addKeyAt('4key', 7, 8)).rejects.toThrow('start failed');

    expect(useKeyStore.getState().canonicalPositions['4key']).toHaveLength(3);
  });

  it('삽입 편입 전 실패의 lastAck가 같은 ID를 소유하면 payload가 달라도 보존한다', async () => {
    api.commitSemanticOps.mockImplementationOnce(async (ops) => {
      const element = ops[0].elements[0];
      const canonical = documentFromStores();
      canonical.keys = { '4key': ['A', 'B', 'Z'] };
      canonical.keyPositions = {
        '4key': [
          keyAt(ID_A),
          keyAt(ID_B),
          { ...structuredClone(element.position), dx: 999 },
        ],
      } as never;
      api.lastAck = canonical;
      throw new Error('start failed');
    });

    await expect(addKeyAt('4key', 7, 8)).rejects.toThrow('start failed');

    expect(useKeyStore.getState().canonicalPositions['4key']).toHaveLength(3);
    expect(useKeyStore.getState().keyMappings['4key']).toEqual(['A', 'B', '']);
  });

  it('삽입 실패 전에 store가 같은 ID의 외부 payload로 바뀌면 그 요소를 보존한다', async () => {
    let externalPosition!: ReturnType<typeof keyAt>;
    api.commitSemanticOps.mockImplementationOnce(async (ops) => {
      const element = ops[0].elements[0];
      externalPosition = { ...structuredClone(element.position), dx: 777 };
      const canonical = documentFromStores();
      canonical.keys = { '4key': ['A', 'B', 'Z'] };
      canonical.keyPositions = {
        '4key': [keyAt(ID_A), keyAt(ID_B), externalPosition],
      } as never;
      api.lastAck = canonical;
      useKeyStore.setState({
        keyMappings: canonical.keys,
        canonicalPositions: canonical.keyPositions,
        positions: canonical.keyPositions,
      });
      throw new Error('start failed');
    });

    await expect(addKeyAt('4key', 7, 8)).rejects.toThrow('start failed');

    expect(useKeyStore.getState().canonicalPositions['4key']).toEqual([
      keyAt(ID_A),
      keyAt(ID_B),
      externalPosition,
    ]);
    expect(useKeyStore.getState().keyMappings['4key']).toEqual(['A', 'B', 'Z']);
  });

  it('lastAck에는 없지만 store가 같은 ID의 후속 payload로 바뀌면 보존한다', async () => {
    let externalPosition!: ReturnType<typeof keyAt>;
    api.commitSemanticOps.mockImplementationOnce(async (ops) => {
      const element = ops[0].elements[0];
      externalPosition = { ...structuredClone(element.position), dx: 555 };
      useKeyStore.setState({
        keyMappings: { '4key': ['A', 'B', 'Y'] },
        canonicalPositions: {
          '4key': [keyAt(ID_A), keyAt(ID_B), externalPosition],
        },
        positions: {
          '4key': [keyAt(ID_A), keyAt(ID_B), externalPosition],
        },
      });
      throw new Error('start failed');
    });

    await expect(addKeyAt('4key', 7, 8)).rejects.toThrow('start failed');

    expect(useKeyStore.getState().canonicalPositions['4key']).toEqual([
      keyAt(ID_A),
      keyAt(ID_B),
      externalPosition,
    ]);
    expect(useKeyStore.getState().keyMappings['4key']).toEqual(['A', 'B', 'Y']);
  });

  it('재바인딩의 편입 전 실패는 슬롯을 복원한다', async () => {
    api.commitSemanticOps.mockRejectedValue(new Error('start failed'));

    await expect(rebindKeySlotById(ID_A, 'Z')).rejects.toThrow('start failed');

    expect(useKeyStore.getState().keyMappings['4key']).toEqual(['A', 'B']);
  });

  it('semantic op는 compat 큐 선행 작업 뒤에 커밋한다', async () => {
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = enqueueEditorCompatibilityWrite(
      () => blocker,
      () => undefined,
    );

    const pre = documentFromStores();
    slotBase = () => pre;
    const pending = deleteElementById('key', ID_A);
    let settled = false;
    void pending.finally(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    release();
    await first;
    expect(await pending).toBe(true);
    expect(api.commitSemanticOps).toHaveBeenCalledOnce();
  });

  it('재바인딩 대상이 사라졌으면 커밋하지 않는다', async () => {
    api.commitSemanticOps.mockResolvedValueOnce({
      document: documentFromStores(),
      opResults: [{ status: 'targetMissing' }],
    });

    await expect(rebindKeySlotById(ID_A, 'Z')).resolves.toBe(false);

    expect(api.commitSemanticOps).toHaveBeenCalledWith(
      [{ kind: 'setKeySlot', id: ID_A, slot: 'Z' }],
      expect.objectContaining({ onEnrolled: expect.any(Function) }),
    );
  });

  it('stable hidden literal은 patchElement op로만 전송한다', async () => {
    await expect(patchElementHiddenById('key', ID_A, true)).resolves.toBe(true);

    expect(useKeyStore.getState().canonicalPositions['4key'][0].hidden).toBe(
      true,
    );
    expect(api.commitSemanticOps).toHaveBeenCalledWith(
      [
        {
          kind: 'patchElement',
          elementType: 'key',
          id: ID_A,
          patch: { hidden: true },
        },
      ],
      expect.objectContaining({ onEnrolled: expect.any(Function) }),
    );
    expect(api.commitGeneratedPatch).not.toHaveBeenCalled();
  });

  it('hidden noChange는 성공으로, targetMissing은 미적용으로 반환한다', async () => {
    useKeyStore.setState({
      canonicalPositions: {
        '4key': [{ ...keyAt(ID_A), hidden: true }, keyAt(ID_B)],
      },
      positions: {
        '4key': [{ ...keyAt(ID_A), hidden: true }, keyAt(ID_B)],
      },
    });
    api.commitSemanticOps
      .mockResolvedValueOnce({
        document: documentFromStores(),
        opResults: [{ status: 'noChange' }],
      })
      .mockResolvedValueOnce({
        document: documentFromStores(),
        opResults: [{ status: 'targetMissing' }],
      });

    await expect(patchElementHiddenById('key', ID_A, true)).resolves.toBe(true);
    await expect(patchElementHiddenById('key', ID_A, false)).resolves.toBe(
      false,
    );
  });

  it('hidden patch 편입 전 실패는 자기 eager만 복원한다', async () => {
    api.commitSemanticOps.mockRejectedValueOnce(new Error('start failed'));
    await expect(patchElementHiddenById('key', ID_A, true)).rejects.toThrow(
      'start failed',
    );
    expect(
      useKeyStore.getState().canonicalPositions['4key'][0].hidden ?? false,
    ).toBe(false);
  });

  it('hidden patch preflight 실패는 wire 편입 전 eager를 복원한다', async () => {
    const preflight = vi.fn(() => {
      throw new Error('authority changed');
    });
    api.commitSemanticOps.mockImplementationOnce(async (_ops, meta) => {
      meta?.preflight?.();
      throw new Error('wire must not run');
    });

    await expect(
      patchElementHiddenById('key', ID_A, true, { preflight }),
    ).rejects.toThrow('authority changed');

    expect(preflight).toHaveBeenCalledOnce();
    expect(
      useKeyStore.getState().canonicalPositions['4key'][0].hidden ?? false,
    ).toBe(false);
  });

  it('hidden patch 편입 후 실패는 caller receipt로 이중 복원하지 않는다', async () => {
    api.commitSemanticOps.mockImplementationOnce(async (_ops, meta) => {
      meta?.onEnrolled?.();
      throw new Error('terminal failure');
    });

    await expect(patchElementHiddenById('key', ID_A, true)).rejects.toThrow(
      'terminal failure',
    );
    expect(useKeyStore.getState().canonicalPositions['4key'][0].hidden).toBe(
      true,
    );
  });

  it('layerName literal과 clear는 좁은 patchElement op로 전송한다', async () => {
    await expect(
      patchElementLayerNameById('key', ID_A, 'Layer A'),
    ).resolves.toBe(true);
    expect(useKeyStore.getState().canonicalPositions['4key'][0].layerName).toBe(
      'Layer A',
    );
    expect(api.commitSemanticOps).toHaveBeenLastCalledWith(
      [
        {
          kind: 'patchElement',
          elementType: 'key',
          id: ID_A,
          patch: { layerName: 'Layer A' },
        },
      ],
      expect.objectContaining({ onEnrolled: expect.any(Function) }),
    );

    await patchElementLayerNameById('key', ID_A, null);
    expect(
      useKeyStore.getState().canonicalPositions['4key'][0].layerName,
    ).toBeUndefined();
    expect(api.commitSemanticOps).toHaveBeenLastCalledWith(
      [expect.objectContaining({ patch: { layerName: null } })],
      expect.anything(),
    );
  });

  it('layerName 편입 전 실패는 자기 leaf만 CAS 복원한다', async () => {
    useKeyStore.setState({
      canonicalPositions: {
        '4key': [{ ...keyAt(ID_A), layerName: 'Before' }, keyAt(ID_B)],
      },
      positions: {
        '4key': [{ ...keyAt(ID_A), layerName: 'Before' }, keyAt(ID_B)],
      },
    });
    api.commitSemanticOps.mockRejectedValueOnce(new Error('start failed'));

    await expect(
      patchElementLayerNameById('key', ID_A, 'After'),
    ).rejects.toThrow('start failed');
    expect(useKeyStore.getState().canonicalPositions['4key'][0].layerName).toBe(
      'Before',
    );
  });

  it('graphType single과 batch는 좁은 op를 한 커밋으로 전송한다', async () => {
    const graphB = '00000000-0000-4000-8000-00000000008e';
    useGraphItemStore.setState({
      positions: {
        '4key': [
          graphAt(ID_A, { graphType: 'line' }),
          graphAt(graphB, { graphType: 'line' }),
        ],
      },
    });

    await patchGraphTypeById(ID_A, 'bar');
    expect(useGraphItemStore.getState().positions['4key'][0].graphType).toBe(
      'bar',
    );

    api.commitSemanticOps.mockClear();
    await patchGraphTypesByIds([ID_A, graphB], 'bar');
    expect(api.commitSemanticOps).toHaveBeenCalledOnce();
    expect(api.commitSemanticOps.mock.calls[0]?.[0]).toEqual([
      {
        kind: 'patchElement',
        elementType: 'graph',
        id: ID_A,
        patch: { graphType: 'bar' },
      },
      {
        kind: 'patchElement',
        elementType: 'graph',
        id: graphB,
        patch: { graphType: 'bar' },
      },
    ]);
  });

  it('graphType batch 편입 전 실패는 모든 eager leaf를 복원한다', async () => {
    const graphB = '00000000-0000-4000-8000-00000000008f';
    useGraphItemStore.setState({
      positions: {
        '4key': [
          graphAt(ID_A, { graphType: 'line' }),
          graphAt(graphB, { graphType: 'line' }),
        ],
      },
    });
    api.commitSemanticOps.mockRejectedValueOnce(new Error('start failed'));

    await expect(patchGraphTypesByIds([ID_A, graphB], 'bar')).rejects.toThrow(
      'start failed',
    );
    expect(
      useGraphItemStore
        .getState()
        .positions['4key'].map((position) => position.graphType),
    ).toEqual(['line', 'line']);
  });

  it('graphType batch는 일부 missing이어도 생존 대상 적용으로 판정한다', async () => {
    const missingId = '00000000-0000-4000-8000-000000000090';
    api.commitSemanticOps.mockResolvedValueOnce({
      document: documentFromStores(),
      opResults: [{ status: 'applied' }, { status: 'targetMissing' }],
    });

    await expect(patchGraphTypesByIds([ID_A, missingId], 'bar')).resolves.toBe(
      true,
    );
    expect(api.commitSemanticOps).toHaveBeenCalledOnce();
  });

  it('graphType batch의 빈 ID와 중복 ID는 eager와 wire 전에 거절한다', async () => {
    await expect(patchGraphTypesByIds([ID_A, ''], 'bar')).resolves.toBe(false);
    await expect(patchGraphTypesByIds([ID_A, ID_A], 'bar')).resolves.toBe(
      false,
    );

    expect(api.commitSemanticOps).not.toHaveBeenCalled();
  });

  it('graphColor single과 batch는 raw literal을 좁은 op 한 커밋으로 보낸다', async () => {
    const graphB = '00000000-0000-4000-8000-000000000092';
    useGraphItemStore.setState({
      positions: {
        '4key': [graphAt(ID_A), graphAt(graphB)],
      },
    });

    await patchGraphColorById(ID_A, '  custom  ');
    expect(useGraphItemStore.getState().positions['4key'][0].graphColor).toBe(
      '  custom  ',
    );

    api.commitSemanticOps.mockClear();
    await patchGraphColorsByIds([ID_A, graphB], '#123456');
    expect(api.commitSemanticOps).toHaveBeenCalledOnce();
    expect(api.commitSemanticOps.mock.calls[0]?.[0]).toEqual([
      {
        kind: 'patchElement',
        elementType: 'graph',
        id: ID_A,
        patch: { graphColor: '#123456' },
      },
      {
        kind: 'patchElement',
        elementType: 'graph',
        id: graphB,
        patch: { graphColor: '#123456' },
      },
    ]);
  });

  it('graphColor batch 편입 전 실패는 모든 eager leaf를 복원한다', async () => {
    const graphB = '00000000-0000-4000-8000-000000000093';
    useGraphItemStore.setState({
      positions: {
        '4key': [graphAt(ID_A), graphAt(graphB)],
      },
    });
    api.commitSemanticOps.mockRejectedValueOnce(new Error('start failed'));

    await expect(
      patchGraphColorsByIds([ID_A, graphB], '#abcdef'),
    ).rejects.toThrow('start failed');
    expect(
      useGraphItemStore
        .getState()
        .positions['4key'].map((position) => position.graphColor),
    ).toEqual(['#86EFAC', '#86EFAC']);
  });

  it.each([
    [{ showAvgLine: true }],
    [{ graphAnimationEnabled: false }],
    [{ graphSpeed: 2400 }],
  ] as const)(
    'graph runtime leaf %j는 single과 batch를 좁은 op 한 커밋으로 보낸다',
    async (patch) => {
      const graphB = '00000000-0000-4000-8000-000000000094';
      useGraphItemStore.setState({
        positions: { '4key': [graphAt(ID_A), graphAt(graphB)] },
      });

      await patchGraphPropertyById(ID_A, patch);
      expect(api.commitSemanticOps).toHaveBeenLastCalledWith(
        [
          {
            kind: 'patchElement',
            elementType: 'graph',
            id: ID_A,
            patch,
          },
        ],
        expect.objectContaining({ onEnrolled: expect.any(Function) }),
      );

      api.commitSemanticOps.mockClear();
      await patchGraphPropertiesByIds([ID_A, graphB], patch);
      expect(api.commitSemanticOps).toHaveBeenCalledOnce();
      expect(api.commitSemanticOps.mock.calls[0]?.[0]).toEqual([
        expect.objectContaining({ id: ID_A, patch }),
        expect.objectContaining({ id: graphB, patch }),
      ]);
    },
  );

  it.each([[{ reverse: true }], [{ sensitivity: 2.5 }]] as const)(
    'knob runtime leaf %j는 single과 batch를 좁은 op 한 커밋으로 보낸다',
    async (patch) => {
      const knobB = '00000000-0000-4000-8000-000000000095';
      const knob = (id: string) => ({
        ...createDefaultKeyPosition(),
        id,
        axisId: 'HIDA:test',
        sensitivity: 1,
        reverse: false,
      });
      useKnobItemStore.setState({
        positions: { '4key': [knob(ID_A), knob(knobB)] },
      });

      await patchKnobPropertyById(ID_A, patch);
      expect(api.commitSemanticOps).toHaveBeenLastCalledWith(
        [
          {
            kind: 'patchElement',
            elementType: 'knob',
            id: ID_A,
            patch,
          },
        ],
        expect.objectContaining({ onEnrolled: expect.any(Function) }),
      );

      api.commitSemanticOps.mockClear();
      await patchKnobPropertiesByIds([ID_A, knobB], patch);
      expect(api.commitSemanticOps).toHaveBeenCalledOnce();
      expect(api.commitSemanticOps.mock.calls[0]?.[0]).toEqual([
        expect.objectContaining({ id: ID_A, patch }),
        expect.objectContaining({ id: knobB, patch }),
      ]);
    },
  );

  it('runtime leaf batch 편입 전 실패는 graph와 knob eager를 각각 복원한다', async () => {
    const otherId = '00000000-0000-4000-8000-000000000096';
    useGraphItemStore.setState({
      positions: {
        '4key': [
          graphAt(ID_A, { graphSpeed: 1000 }),
          graphAt(otherId, { graphSpeed: 1000 }),
        ],
      },
    });
    api.commitSemanticOps.mockRejectedValueOnce(new Error('start failed'));
    await expect(
      patchGraphPropertiesByIds([ID_A, otherId], { graphSpeed: 2200 }),
    ).rejects.toThrow('start failed');
    expect(
      useGraphItemStore
        .getState()
        .positions['4key'].map((position) => position.graphSpeed),
    ).toEqual([1000, 1000]);

    useKnobItemStore.setState({
      positions: {
        '4key': [
          { ...createDefaultKeyPosition(), id: ID_A, sensitivity: 1 },
          { ...createDefaultKeyPosition(), id: otherId, sensitivity: 1 },
        ] as never,
      },
    });
    api.commitSemanticOps.mockRejectedValueOnce(new Error('start failed'));
    await expect(
      patchKnobPropertiesByIds([ID_A, otherId], { sensitivity: 3 }),
    ).rejects.toThrow('start failed');
    expect(
      useKnobItemStore
        .getState()
        .positions['4key'].map((position) => position.sensitivity),
    ).toEqual([1, 1]);
  });

  it('useInlineStyles는 4타입 target을 한 semantic commit으로 보낸다', async () => {
    const targets = [
      { elementType: 'key' as const, id: ID_A },
      { elementType: 'stat' as const, id: ID_B },
      {
        elementType: 'graph' as const,
        id: '00000000-0000-4000-8000-0000000000b1',
      },
      {
        elementType: 'knob' as const,
        id: '00000000-0000-4000-8000-0000000000b2',
      },
    ];

    await patchUseInlineStylesById('key', ID_A, true);
    expect(api.commitSemanticOps).toHaveBeenLastCalledWith(
      [
        {
          kind: 'patchElement',
          elementType: 'key',
          id: ID_A,
          patch: { useInlineStyles: true },
        },
      ],
      expect.objectContaining({ onEnrolled: expect.any(Function) }),
    );

    api.commitSemanticOps.mockClear();
    await patchUseInlineStylesByTargets(targets, false);
    expect(api.commitSemanticOps).toHaveBeenCalledOnce();
    expect(api.commitSemanticOps.mock.calls[0]?.[0]).toEqual(
      targets.map(({ elementType, id }) => ({
        kind: 'patchElement',
        elementType,
        id,
        patch: { useInlineStyles: false },
      })),
    );
  });

  it('useInlineStyles batch는 duplicate와 empty ID를 wire 전에 거절한다', async () => {
    await expect(
      patchUseInlineStylesByTargets(
        [
          { elementType: 'key', id: ID_A },
          { elementType: 'stat', id: ID_A },
        ],
        true,
      ),
    ).resolves.toBe(false);
    await expect(
      patchUseInlineStylesByTargets([{ elementType: 'graph', id: '' }], true),
    ).resolves.toBe(false);
    expect(api.commitSemanticOps).not.toHaveBeenCalled();
  });

  it('useInlineStyles 편입 전 실패는 자기 eager leaf를 복원한다', async () => {
    api.commitSemanticOps.mockRejectedValueOnce(new Error('start failed'));

    await expect(patchUseInlineStylesById('key', ID_A, false)).rejects.toThrow(
      'start failed',
    );

    expect(
      useKeyStore.getState().canonicalPositions['4key'][0].useInlineStyles,
    ).toBeUndefined();
  });

  it('font style은 단일과 혼합 4타입 target을 exact leaf 한 commit으로 보낸다', async () => {
    const targets = [
      { elementType: 'key' as const, id: ID_A },
      { elementType: 'stat' as const, id: ID_B },
      {
        elementType: 'graph' as const,
        id: '00000000-0000-4000-8000-0000000000c1',
      },
      {
        elementType: 'knob' as const,
        id: '00000000-0000-4000-8000-0000000000c2',
      },
    ];

    await patchFontStyleById('key', ID_A, { fontWeight: 700 });
    expect(api.commitSemanticOps).toHaveBeenLastCalledWith(
      [
        {
          kind: 'patchElement',
          elementType: 'key',
          id: ID_A,
          patch: { fontWeight: 700 },
        },
      ],
      expect.objectContaining({ onEnrolled: expect.any(Function) }),
    );

    api.commitSemanticOps.mockClear();
    await patchFontStyleByTargets(targets, { fontItalic: false });
    expect(api.commitSemanticOps).toHaveBeenCalledOnce();
    expect(api.commitSemanticOps.mock.calls[0]?.[0]).toEqual(
      targets.map(({ elementType, id }) => ({
        kind: 'patchElement',
        elementType,
        id,
        patch: { fontItalic: false },
      })),
    );
  });

  it('font style batch는 duplicate와 empty ID를 wire 전에 거절한다', async () => {
    await expect(
      patchFontStyleByTargets(
        [
          { elementType: 'key', id: ID_A },
          { elementType: 'stat', id: ID_A },
        ],
        { fontUnderline: true },
      ),
    ).resolves.toBe(false);
    await expect(
      patchFontStyleByTargets([{ elementType: 'graph', id: '' }], {
        fontStrikethrough: true,
      }),
    ).resolves.toBe(false);
    expect(api.commitSemanticOps).not.toHaveBeenCalled();
  });

  it('font style 편입 전 실패는 자기 eager leaf만 복원한다', async () => {
    useKeyStore.setState((state) => ({
      canonicalPositions: {
        ...state.canonicalPositions,
        '4key': state.canonicalPositions['4key'].map((position) => ({
          ...position,
          fontItalic: false,
        })),
      },
    }));
    api.commitSemanticOps.mockRejectedValueOnce(new Error('start failed'));

    await expect(
      patchFontStyleById('key', ID_A, { fontItalic: true }),
    ).rejects.toThrow('start failed');

    expect(
      useKeyStore.getState().canonicalPositions['4key'][0].fontItalic,
    ).toBe(false);
  });

  it('fontFamily는 raw string을 single과 혼합 4타입 한 commit으로 보낸다', async () => {
    const targets = [
      { elementType: 'key' as const, id: ID_A },
      { elementType: 'stat' as const, id: ID_B },
      {
        elementType: 'graph' as const,
        id: '00000000-0000-4000-8000-0000000000c3',
      },
      {
        elementType: 'knob' as const,
        id: '00000000-0000-4000-8000-0000000000c4',
      },
    ];

    await patchFontFamilyById('key', ID_A, '  Raw Family  ');
    expect(api.commitSemanticOps).toHaveBeenLastCalledWith(
      [
        {
          kind: 'patchElement',
          elementType: 'key',
          id: ID_A,
          patch: { fontFamily: '  Raw Family  ' },
        },
      ],
      expect.objectContaining({ onEnrolled: expect.any(Function) }),
    );

    api.commitSemanticOps.mockClear();
    await patchFontFamilyByTargets(targets, { fontFamily: 'Family One' });
    expect(api.commitSemanticOps).toHaveBeenCalledOnce();
    expect(api.commitSemanticOps.mock.calls[0]?.[0]).toEqual(
      targets.map(({ elementType, id }) => ({
        kind: 'patchElement',
        elementType,
        id,
        patch: { fontFamily: 'Family One' },
      })),
    );
  });

  it('fontFamily batch는 duplicate와 empty ID를 wire 전에 거절한다', async () => {
    await expect(
      patchFontFamilyByTargets(
        [
          { elementType: 'key', id: ID_A },
          { elementType: 'stat', id: ID_A },
        ],
        { fontFamily: 'Family One' },
      ),
    ).resolves.toBe(false);
    await expect(
      patchFontFamilyByTargets([{ elementType: 'graph', id: '' }], {
        fontFamily: 'Family One',
      }),
    ).resolves.toBe(false);
    expect(api.commitSemanticOps).not.toHaveBeenCalled();
  });

  it('fontFamily 편입 전 실패는 top-level eager leaf만 복원한다', async () => {
    useKeyStore.setState((state) => ({
      canonicalPositions: {
        ...state.canonicalPositions,
        '4key': state.canonicalPositions['4key'].map((position) => ({
          ...position,
          fontFamily: 'Before',
          counter: { ...position.counter, fontFamily: 'Counter Family' },
        })),
      },
      positions: {
        ...state.positions,
        '4key': state.positions['4key'].map((position) => ({
          ...position,
          fontFamily: 'Before',
          counter: { ...position.counter, fontFamily: 'Counter Family' },
        })),
      },
    }));
    api.commitSemanticOps.mockRejectedValueOnce(new Error('start failed'));

    await expect(patchFontFamilyById('key', ID_A, 'After')).rejects.toThrow(
      'start failed',
    );

    expect(useKeyStore.getState().canonicalPositions['4key'][0]).toMatchObject({
      fontFamily: 'Before',
      counter: { fontFamily: 'Counter Family' },
    });
  });

  it('note literal은 single과 key batch를 exact leaf 한 commit으로 보낸다', async () => {
    await patchNotePropertyById(ID_A, { noteEffectEnabled: false });
    expect(api.commitSemanticOps).toHaveBeenLastCalledWith(
      [
        {
          kind: 'patchElement',
          elementType: 'key',
          id: ID_A,
          patch: { noteEffectEnabled: false },
        },
      ],
      expect.objectContaining({ onEnrolled: expect.any(Function) }),
    );

    api.commitSemanticOps.mockClear();
    await patchNotePropertiesByIds([ID_A, ID_B], {
      noteBorderSide: 'vertical',
    });
    expect(api.commitSemanticOps).toHaveBeenCalledOnce();
    expect(api.commitSemanticOps.mock.calls[0]?.[0]).toEqual([
      {
        kind: 'patchElement',
        elementType: 'key',
        id: ID_A,
        patch: { noteBorderSide: 'vertical' },
      },
      {
        kind: 'patchElement',
        elementType: 'key',
        id: ID_B,
        patch: { noteBorderSide: 'vertical' },
      },
    ]);
  });

  it('note batch는 duplicate와 empty ID를 wire 전에 거절한다', async () => {
    await expect(
      patchNotePropertiesByIds([ID_A, ID_A], { noteAlignment: 'center' }),
    ).resolves.toBe(false);
    await expect(
      patchNotePropertiesByIds([''], { noteGlowEnabled: true }),
    ).resolves.toBe(false);
    expect(api.commitSemanticOps).not.toHaveBeenCalled();
  });

  it('knob axisId는 raw absolute leaf만 한 semantic op로 보낸다', async () => {
    useKnobItemStore.setState({
      positions: {
        '4key': [
          {
            ...keyAt(ID_A),
            axisId: 'old',
            sensitivity: 1,
            reverse: false,
          } as never,
        ],
      },
    });

    await patchKnobAxisIdById(ID_A, '  HIDA:raw  ');

    expect(api.commitSemanticOps).toHaveBeenCalledWith(
      [
        {
          kind: 'patchElement',
          elementType: 'knob',
          id: ID_A,
          patch: { axisId: '  HIDA:raw  ' },
        },
      ],
      expect.anything(),
    );
    expect(useKnobItemStore.getState().positions['4key'][0]).toMatchObject({
      axisId: '  HIDA:raw  ',
      sensitivity: 1,
      reverse: false,
    });
  });

  it('soundPath는 key raw string을 single과 N ops 한 commit으로 보내고 형제를 보존한다', async () => {
    const records = [
      {
        ...keyAt(ID_A),
        soundPath: 'sounds/a.wav',
        soundEnabled: true,
        soundVolume: 137,
      },
      {
        ...keyAt(ID_B),
        soundPath: 'sounds/b.wav',
        soundEnabled: false,
        soundVolume: 54,
      },
    ];
    useKeyStore.setState({
      canonicalPositions: { '4key': records },
      positions: { '4key': structuredClone(records) },
    });

    await patchSoundPathById(ID_A, '  sounds/raw.wav  ');
    expect(api.commitSemanticOps).toHaveBeenLastCalledWith(
      [
        {
          kind: 'patchElement',
          elementType: 'key',
          id: ID_A,
          patch: { soundPath: '  sounds/raw.wav  ' },
        },
      ],
      expect.anything(),
    );

    await patchSoundPathByIds([ID_A, ID_B], '');
    expect(api.commitSemanticOps).toHaveBeenLastCalledWith(
      [ID_A, ID_B].map((id) => ({
        kind: 'patchElement',
        elementType: 'key',
        id,
        patch: { soundPath: '' },
      })),
      expect.anything(),
    );
    expect(useKeyStore.getState().positions['4key']).toEqual([
      expect.objectContaining({
        id: ID_A,
        soundPath: '',
        soundEnabled: true,
        soundVolume: 137,
      }),
      expect.objectContaining({
        id: ID_B,
        soundPath: '',
        soundEnabled: false,
        soundVolume: 54,
      }),
    ]);
  });

  it('soundEnabled는 key bool leaf만 single과 N ops 한 commit으로 보내고 사운드 형제를 보존한다', async () => {
    const records = [
      {
        ...keyAt(ID_A),
        soundPath: 'sounds/a.wav',
        soundEnabled: false,
        soundVolume: 137,
      },
      {
        ...keyAt(ID_B),
        soundPath: 'sounds/b.wav',
        soundEnabled: false,
        soundVolume: 54,
      },
    ];
    useKeyStore.setState({
      canonicalPositions: { '4key': records },
      positions: { '4key': structuredClone(records) },
    });

    await patchSoundEnabledById(ID_A, true);
    expect(api.commitSemanticOps).toHaveBeenLastCalledWith(
      [
        {
          kind: 'patchElement',
          elementType: 'key',
          id: ID_A,
          patch: { soundEnabled: true },
        },
      ],
      expect.anything(),
    );

    await patchSoundEnabledByIds([ID_A, ID_B], true);
    expect(api.commitSemanticOps).toHaveBeenLastCalledWith(
      [ID_A, ID_B].map((id) => ({
        kind: 'patchElement',
        elementType: 'key',
        id,
        patch: { soundEnabled: true },
      })),
      expect.anything(),
    );
    expect(useKeyStore.getState().positions['4key']).toEqual([
      expect.objectContaining({
        id: ID_A,
        soundPath: 'sounds/a.wav',
        soundEnabled: true,
        soundVolume: 137,
      }),
      expect.objectContaining({
        id: ID_B,
        soundPath: 'sounds/b.wav',
        soundEnabled: true,
        soundVolume: 54,
      }),
    ]);
  });

  it('soundEnabled batch는 empty, duplicate, synthetic ID를 wire 전에 거절한다', async () => {
    await expect(patchSoundEnabledByIds([], true)).resolves.toBe(false);
    await expect(patchSoundEnabledByIds([ID_A, ID_A], true)).resolves.toBe(
      false,
    );
    await expect(patchSoundEnabledByIds(['key-0'], true)).resolves.toBe(false);
    expect(api.commitSemanticOps).not.toHaveBeenCalled();
  });

  it('soundVolume은 key finite 0..200 leaf와 gesture만 보내고 사운드 형제를 보존한다', async () => {
    const records = [
      {
        ...keyAt(ID_A),
        soundPath: 'sounds/a.wav',
        soundEnabled: true,
        soundVolume: 23,
        inactiveImage: 'idle.png',
      },
      {
        ...keyAt(ID_B),
        soundPath: 'sounds/b.wav',
        soundEnabled: false,
        soundVolume: 54,
      },
    ];
    useKeyStore.setState({
      canonicalPositions: { '4key': records },
      positions: { '4key': structuredClone(records) },
    });

    await patchSoundVolumeById(ID_A, 137.5, {
      gestureId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    });
    expect(api.commitSemanticOps).toHaveBeenLastCalledWith(
      [
        {
          kind: 'patchElement',
          elementType: 'key',
          id: ID_A,
          patch: { soundVolume: 137.5 },
        },
      ],
      expect.objectContaining({
        gestureId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      }),
    );

    await patchSoundVolumeByIds([ID_A, ID_B], 200);
    expect(api.commitSemanticOps).toHaveBeenLastCalledWith(
      [ID_A, ID_B].map((id) => ({
        kind: 'patchElement',
        elementType: 'key',
        id,
        patch: { soundVolume: 200 },
      })),
      expect.anything(),
    );
    expect(useKeyStore.getState().positions['4key']).toEqual([
      expect.objectContaining({
        soundVolume: 200,
        soundPath: 'sounds/a.wav',
        soundEnabled: true,
        inactiveImage: 'idle.png',
      }),
      expect.objectContaining({
        soundVolume: 200,
        soundPath: 'sounds/b.wav',
        soundEnabled: false,
      }),
    ]);
  });

  it('soundVolume은 invalid value와 empty, duplicate, synthetic ID를 wire 전에 거절한다', async () => {
    await expect(patchSoundVolumeByIds([], 100)).resolves.toBe(false);
    await expect(patchSoundVolumeByIds([ID_A, ID_A], 100)).resolves.toBe(false);
    await expect(patchSoundVolumeByIds(['key-0'], 100)).resolves.toBe(false);
    await expect(patchSoundVolumeByIds([ID_A], -1)).resolves.toBe(false);
    await expect(patchSoundVolumeByIds([ID_A], 201)).resolves.toBe(false);
    await expect(patchSoundVolumeByIds([ID_A], Number.NaN)).resolves.toBe(
      false,
    );
    expect(api.commitSemanticOps).not.toHaveBeenCalled();
  });

  it('soundPath batch는 empty, duplicate, synthetic ID를 wire 전에 거절한다', async () => {
    await expect(patchSoundPathByIds([], 'sounds/a.wav')).resolves.toBe(false);
    await expect(
      patchSoundPathByIds([ID_A, ID_A], 'sounds/a.wav'),
    ).resolves.toBe(false);
    await expect(patchSoundPathByIds(['key-0'], 'sounds/a.wav')).resolves.toBe(
      false,
    );
    expect(api.commitSemanticOps).not.toHaveBeenCalled();
  });

  it('counter animation preset은 지정 leaf만 eager/wire에 적용하고 raw counter sibling을 보존한다', async () => {
    const rawCounter = {
      ...createDefaultKeyPosition().counter,
      fontFamily: null,
      customSentinel: 'keep-raw',
      animation: {
        ...createDefaultKeyPosition().counter.animation,
        enabled: false,
        presetId: 'preset-old',
        scale: 1.1,
      },
    };
    useKeyStore.setState({
      canonicalPositions: {
        '4key': [{ ...keyAt(ID_A), counter: rawCounter }, keyAt(ID_B)],
      },
      positions: {
        '4key': [{ ...keyAt(ID_A), counter: rawCounter }, keyAt(ID_B)],
      },
    });

    await patchCounterAnimationPresetByTargets(
      [{ elementType: 'key', id: ID_A }],
      { presetId: 'preset-new', applyPresetId: true, durationMs: 450 },
    );

    expect(api.commitSemanticOps).toHaveBeenLastCalledWith(
      [
        {
          kind: 'patchElement',
          elementType: 'key',
          id: ID_A,
          patch: {
            counterAnimationPreset: {
              presetId: 'preset-new',
              applyPresetId: true,
              durationMs: 450,
            },
          },
        },
      ],
      expect.anything(),
    );
    expect(
      useKeyStore.getState().canonicalPositions['4key'][0].counter,
    ).toMatchObject({
      fontFamily: null,
      customSentinel: 'keep-raw',
      animation: {
        enabled: false,
        presetId: 'preset-new',
        scale: 1.1,
        durationMs: 450,
      },
    });
  });

  it('single edit preset intent는 외부가 바꾼 fresh presetId를 보존한다', async () => {
    const current = keyAt(ID_A);
    current.counter = {
      ...current.counter,
      animation: {
        ...current.counter.animation,
        presetId: 'preset-c',
        scale: 2,
      },
    };
    useKeyStore.setState({
      canonicalPositions: { '4key': [current, keyAt(ID_B)] },
      positions: { '4key': [current, keyAt(ID_B)] },
    });

    await patchCounterAnimationPresetByTargets(
      [{ elementType: 'key', id: ID_A }],
      { presetId: 'preset-a', scale: 1.4 },
    );

    expect(
      useKeyStore.getState().canonicalPositions['4key'][0].counter.animation,
    ).toMatchObject({ presetId: 'preset-c', scale: 1.4 });
    expect(api.commitSemanticOps).toHaveBeenLastCalledWith(
      [
        expect.objectContaining({
          patch: {
            counterAnimationPreset: {
              presetId: 'preset-a',
              scale: 1.4,
            },
          },
        }),
      ],
      expect.anything(),
    );
  });

  it('counter animation batch는 empty, duplicate, synthetic target을 wire 전에 거절한다', async () => {
    const intent = { presetId: 'preset-a' };
    await expect(
      patchCounterAnimationPresetByTargets([], intent),
    ).resolves.toBe(false);
    await expect(
      patchCounterAnimationPresetByTargets(
        [
          { elementType: 'key', id: ID_A },
          { elementType: 'stat', id: ID_A },
        ],
        intent,
      ),
    ).resolves.toBe(false);
    await expect(
      patchCounterAnimationPresetByTargets(
        [{ elementType: 'key', id: 'key-0' }],
        intent,
      ),
    ).resolves.toBe(false);
  });

  it('counter bool 두 leaf는 raw counter와 preset sibling을 보존해 key/stat 한 commit으로 보낸다', async () => {
    const statId = '33333333-3333-4333-8333-333333333333';
    const rawCounter = {
      ...createDefaultKeyPosition().counter,
      enabled: false,
      customSentinel: 'keep-raw',
      animation: {
        ...createDefaultKeyPosition().counter.animation,
        enabled: false,
        presetId: 'preset-keep',
        scale: 1.7,
      },
    };
    useKeyStore.setState({
      canonicalPositions: {
        '4key': [{ ...keyAt(ID_A), counter: rawCounter }],
      },
      positions: { '4key': [{ ...keyAt(ID_A), counter: rawCounter }] },
    });
    useStatItemStore.setState({
      positions: {
        '4key': [
          {
            ...keyAt(statId),
            statType: 'kps',
            counter: structuredClone(rawCounter),
          },
        ],
      },
    });
    api.captureEditorDocument.mockReturnValue(documentFromStores());
    const targets = [
      { elementType: 'key' as const, id: ID_A },
      { elementType: 'stat' as const, id: statId },
    ];

    await patchCounterEnabledByTargets(targets, true);
    expect(api.commitSemanticOps).toHaveBeenLastCalledWith(
      targets.map(({ elementType, id }) => ({
        kind: 'patchElement',
        elementType,
        id,
        patch: { counterEnabled: true },
      })),
      expect.anything(),
    );
    expect(
      useKeyStore.getState().canonicalPositions['4key'][0].counter,
    ).toMatchObject({
      enabled: true,
      customSentinel: 'keep-raw',
      animation: { enabled: false, presetId: 'preset-keep', scale: 1.7 },
    });

    api.captureEditorDocument.mockReturnValue(documentFromStores());
    await patchCounterAnimationEnabledByTargets(targets, true);
    expect(api.commitSemanticOps).toHaveBeenLastCalledWith(
      targets.map(({ elementType, id }) => ({
        kind: 'patchElement',
        elementType,
        id,
        patch: { counterAnimationEnabled: true },
      })),
      expect.anything(),
    );
    expect(
      useKeyStore.getState().canonicalPositions['4key'][0].counter,
    ).toMatchObject({
      enabled: true,
      customSentinel: 'keep-raw',
      animation: { enabled: true, presetId: 'preset-keep', scale: 1.7 },
    });
  });

  it('counter bool batch는 empty, duplicate, synthetic target을 wire 전에 거절한다', async () => {
    await expect(patchCounterEnabledByTargets([], true)).resolves.toBe(false);
    await expect(
      patchCounterAnimationEnabledByTargets(
        [
          { elementType: 'key', id: ID_A },
          { elementType: 'stat', id: ID_A },
        ],
        true,
      ),
    ).resolves.toBe(false);
    await expect(
      patchCounterEnabledByTargets([{ elementType: 'key', id: 'key-0' }], true),
    ).resolves.toBe(false);
  });

  it('counter layout 4 leaf는 raw counter sibling을 보존해 key/stat N ops 한 commit으로 보낸다', async () => {
    const statId = '33333333-3333-4333-8333-333333333333';
    const rawCounter = {
      ...createDefaultKeyPosition().counter,
      placement: 'inside' as const,
      align: 'top' as const,
      alignMode: 'between' as const,
      gap: 3,
      customSentinel: 'keep-raw',
    };
    useKeyStore.setState({
      canonicalPositions: { '4key': [{ ...keyAt(ID_A), counter: rawCounter }] },
      positions: { '4key': [{ ...keyAt(ID_A), counter: rawCounter }] },
    });
    useStatItemStore.setState({
      positions: {
        '4key': [
          {
            ...keyAt(statId),
            statType: 'kps',
            counter: structuredClone(rawCounter),
          },
        ],
      },
    });
    api.captureEditorDocument.mockReturnValue(documentFromStores());
    const targets = [
      { elementType: 'key' as const, id: ID_A },
      { elementType: 'stat' as const, id: statId },
    ];

    const patches: EditorCounterLayoutPropertyPatchV1[] = [
      { counterPlacement: 'outside' as const },
      { counterAlign: 'right' as const },
      { counterAlignMode: 'center' as const },
      { counterGap: 4_294_967_295 },
    ];
    for (const patch of patches) {
      api.captureEditorDocument.mockReturnValue(documentFromStores());
      await patchCounterLayoutByTargets(targets, patch);
      expect(api.commitSemanticOps).toHaveBeenLastCalledWith(
        targets.map(({ elementType, id }) => ({
          kind: 'patchElement',
          elementType,
          id,
          patch,
        })),
        expect.anything(),
      );
    }
    expect(
      useKeyStore.getState().canonicalPositions['4key'][0].counter,
    ).toMatchObject({
      placement: 'outside',
      align: 'right',
      alignMode: 'center',
      gap: 4_294_967_295,
      customSentinel: 'keep-raw',
    });
  });

  it('counter layout batch는 empty, duplicate, synthetic target을 wire 전에 거절한다', async () => {
    await expect(
      patchCounterLayoutByTargets([], { counterGap: 2 }),
    ).resolves.toBe(false);
    await expect(
      patchCounterLayoutByTargets(
        [
          { elementType: 'key', id: ID_A },
          { elementType: 'stat', id: ID_A },
        ],
        { counterAlign: 'top' },
      ),
    ).resolves.toBe(false);
    await expect(
      patchCounterLayoutByTargets([{ elementType: 'key', id: 'key-0' }], {
        counterPlacement: 'inside',
      }),
    ).resolves.toBe(false);
  });

  it('counter typography 5 leaf는 raw counter sibling을 보존해 key/stat N ops 한 commit으로 보낸다', async () => {
    const statId = '33333333-3333-4333-8333-333333333333';
    const rawCounter = {
      ...createDefaultKeyPosition().counter,
      customSentinel: 'keep-raw',
    };
    useKeyStore.setState({
      canonicalPositions: { '4key': [{ ...keyAt(ID_A), counter: rawCounter }] },
      positions: { '4key': [{ ...keyAt(ID_A), counter: rawCounter }] },
    });
    useStatItemStore.setState({
      positions: {
        '4key': [
          {
            ...keyAt(statId),
            statType: 'kps',
            counter: structuredClone(rawCounter),
          },
        ],
      },
    });
    const targets = [
      { elementType: 'key' as const, id: ID_A },
      { elementType: 'stat' as const, id: statId },
    ];
    const patches: EditorCounterTypographyPropertyPatchV1[] = [
      { counterFontSize: 72 },
      { counterFontWeight: 900 },
      { counterFontItalic: true },
      { counterFontUnderline: true },
      { counterFontStrikethrough: true },
    ];

    for (const patch of patches) {
      api.captureEditorDocument.mockReturnValue(documentFromStores());
      await patchCounterTypographyByTargets(targets, patch);
      expect(api.commitSemanticOps).toHaveBeenLastCalledWith(
        targets.map(({ elementType, id }) => ({
          kind: 'patchElement',
          elementType,
          id,
          patch,
        })),
        expect.anything(),
      );
    }
    expect(
      useKeyStore.getState().canonicalPositions['4key'][0].counter,
    ).toMatchObject({
      fontSize: 72,
      fontWeight: 900,
      fontItalic: true,
      fontUnderline: true,
      fontStrikethrough: true,
      customSentinel: 'keep-raw',
    });
  });

  it('counter typography는 invalid leaf와 empty, duplicate, synthetic target을 wire 전에 거절한다', async () => {
    await expect(
      patchCounterTypographyByTargets([], { counterFontSize: 8 }),
    ).resolves.toBe(false);
    await expect(
      patchCounterTypographyByTargets(
        [
          { elementType: 'key', id: ID_A },
          { elementType: 'stat', id: ID_A },
        ],
        { counterFontWeight: 400 },
      ),
    ).resolves.toBe(false);
    await expect(
      patchCounterTypographyByTargets([{ elementType: 'key', id: 'key-0' }], {
        counterFontItalic: true,
      }),
    ).resolves.toBe(false);
    await expect(
      patchCounterTypographyByTargets([{ elementType: 'key', id: ID_A }], {
        counterFontSize: 7,
      }),
    ).resolves.toBe(false);
    await expect(
      patchCounterTypographyByTargets([{ elementType: 'key', id: ID_A }], {
        counterFontWeight: 400.5,
      }),
    ).resolves.toBe(false);
    expect(api.commitSemanticOps).not.toHaveBeenCalled();
  });

  it('inactiveImage는 raw string을 single과 혼합 4타입 한 commit으로 보낸다', async () => {
    const statId = '33333333-3333-4333-8333-333333333333';
    const graphId = '44444444-4444-4444-8444-444444444444';
    const knobId = '55555555-5555-4555-8555-555555555555';
    const stat = { ...keyAt(statId), statType: 'kps' } as never;
    const graph = graphAt(graphId, {
      inactiveImage: 'graph-before.png',
      activeImage: 'graph-active.png',
    });
    const knob = {
      ...keyAt(knobId),
      axisId: '',
      sensitivity: 1,
      reverse: false,
    } as never;
    useStatItemStore.setState({ positions: { '4key': [stat] } });
    useGraphItemStore.setState({ positions: { '4key': [graph] } });
    useKnobItemStore.setState({ positions: { '4key': [knob] } });

    await patchInactiveImageById('key', ID_A, '  /tmp/raw.png  ');
    expect(api.commitSemanticOps).toHaveBeenLastCalledWith(
      [
        {
          kind: 'patchElement',
          elementType: 'key',
          id: ID_A,
          patch: { inactiveImage: '  /tmp/raw.png  ' },
        },
      ],
      expect.anything(),
    );

    const targets = [
      { elementType: 'key' as const, id: ID_A },
      { elementType: 'stat' as const, id: statId },
      { elementType: 'graph' as const, id: graphId },
      { elementType: 'knob' as const, id: knobId },
    ];
    await patchInactiveImageByTargets(targets, 'picked.png');
    expect(api.commitSemanticOps).toHaveBeenLastCalledWith(
      targets.map(({ elementType, id }) => ({
        kind: 'patchElement',
        elementType,
        id,
        patch: { inactiveImage: 'picked.png' },
      })),
      expect.anything(),
    );
    expect(useGraphItemStore.getState().positions['4key'][0]).toMatchObject({
      inactiveImage: 'picked.png',
      activeImage: graph.activeImage,
    });
  });

  it('inactiveImage batch는 empty, duplicate, synthetic target을 wire 전에 거절한다', async () => {
    await expect(patchInactiveImageByTargets([], 'picked.png')).resolves.toBe(
      false,
    );
    await expect(
      patchInactiveImageByTargets(
        [
          { elementType: 'key', id: ID_A },
          { elementType: 'stat', id: ID_A },
        ],
        'picked.png',
      ),
    ).resolves.toBe(false);
    await expect(
      patchInactiveImageByTargets(
        [{ elementType: 'knob', id: 'knob-0' }],
        'picked.png',
      ),
    ).resolves.toBe(false);
    expect(api.commitSemanticOps).not.toHaveBeenCalled();
  });

  it('activeImage는 key/knob raw string을 한 commit으로 보내고 형제를 보존한다', async () => {
    const knobId = '66666666-6666-4666-8666-666666666666';
    const knob = {
      ...keyAt(knobId),
      axisId: '',
      sensitivity: 1,
      reverse: false,
      inactiveImage: 'idle.png',
      activeImage: 'before.png',
    } as never;
    useKnobItemStore.setState({ positions: { '4key': [knob] } });

    await patchActiveImageById('key', ID_A, '  /tmp/raw active.png  ');
    expect(api.commitSemanticOps).toHaveBeenLastCalledWith(
      [
        {
          kind: 'patchElement',
          elementType: 'key',
          id: ID_A,
          patch: { activeImage: '  /tmp/raw active.png  ' },
        },
      ],
      expect.anything(),
    );

    const targets = [
      { elementType: 'key' as const, id: ID_A },
      { elementType: 'knob' as const, id: knobId },
    ];
    await patchActiveImageByTargets(targets, '');
    expect(api.commitSemanticOps).toHaveBeenLastCalledWith(
      targets.map(({ elementType, id }) => ({
        kind: 'patchElement',
        elementType,
        id,
        patch: { activeImage: '' },
      })),
      expect.anything(),
    );
    expect(useKnobItemStore.getState().positions['4key'][0]).toMatchObject({
      inactiveImage: 'idle.png',
      activeImage: '',
      sensitivity: 1,
    });
  });

  it('activeImage batch는 empty, duplicate, synthetic target을 wire 전에 거절한다', async () => {
    await expect(patchActiveImageByTargets([], 'active.png')).resolves.toBe(
      false,
    );
    await expect(
      patchActiveImageByTargets(
        [
          { elementType: 'key', id: ID_A },
          { elementType: 'knob', id: ID_A },
        ],
        'active.png',
      ),
    ).resolves.toBe(false);
    await expect(
      patchActiveImageByTargets(
        [{ elementType: 'knob', id: 'knob-0' }],
        'active.png',
      ),
    ).resolves.toBe(false);
    expect(api.commitSemanticOps).not.toHaveBeenCalled();
  });

  it('image transparency는 exact bool leaf만 타입별 N ops로 보내고 이미지 형제를 보존한다', async () => {
    const graphId = '77777777-7777-4777-8777-777777777777';
    const knobId = '88888888-8888-4888-8888-888888888888';
    const graph = graphAt(graphId, {
      inactiveImage: 'idle.png',
      activeImage: 'active.png',
      idleImageFit: 'contain',
      idleTransparent: false,
    });
    const knob = {
      ...keyAt(knobId),
      axisId: '',
      sensitivity: 1,
      reverse: false,
      activeImageFit: 'cover',
      activeTransparent: false,
    } as never;
    useGraphItemStore.setState({ positions: { '4key': [graph] } });
    useKnobItemStore.setState({ positions: { '4key': [knob] } });

    await patchIdleTransparentById('graph', graphId, true);
    expect(api.commitSemanticOps).toHaveBeenLastCalledWith(
      [
        {
          kind: 'patchElement',
          elementType: 'graph',
          id: graphId,
          patch: { idleTransparent: true },
        },
      ],
      expect.anything(),
    );
    expect(useGraphItemStore.getState().positions['4key'][0]).toMatchObject({
      inactiveImage: 'idle.png',
      activeImage: 'active.png',
      idleImageFit: 'contain',
      idleTransparent: true,
    });

    await patchActiveTransparentByTargets(
      [
        { elementType: 'key', id: ID_A },
        { elementType: 'knob', id: knobId },
      ],
      true,
    );
    expect(api.commitSemanticOps).toHaveBeenLastCalledWith(
      [
        {
          kind: 'patchElement',
          elementType: 'key',
          id: ID_A,
          patch: { activeTransparent: true },
        },
        {
          kind: 'patchElement',
          elementType: 'knob',
          id: knobId,
          patch: { activeTransparent: true },
        },
      ],
      expect.anything(),
    );
    expect(useKnobItemStore.getState().positions['4key'][0]).toMatchObject({
      activeImageFit: 'cover',
      activeTransparent: true,
    });
  });

  it('image transparency batch는 empty, duplicate, synthetic target을 wire 전에 거절한다', async () => {
    await expect(patchIdleTransparentByTargets([], true)).resolves.toBe(false);
    await expect(
      patchIdleTransparentByTargets(
        [
          { elementType: 'key', id: ID_A },
          { elementType: 'graph', id: ID_A },
        ],
        true,
      ),
    ).resolves.toBe(false);
    await expect(
      patchActiveTransparentByTargets(
        [{ elementType: 'knob', id: 'knob-0' }],
        true,
      ),
    ).resolves.toBe(false);
    await expect(
      patchActiveTransparentById('key', 'key-0', true),
    ).resolves.toBe(false);
    expect(api.commitSemanticOps).not.toHaveBeenCalled();
  });

  it('single image fit은 state별 exact enum leaf만 보내고 이미지 형제를 보존한다', async () => {
    const knobId = '99999999-9999-4999-8999-999999999999';
    const knob = {
      ...keyAt(knobId),
      axisId: '',
      sensitivity: 1,
      reverse: false,
      imageFit: 'none',
      idleImageFit: 'cover',
      activeImageFit: 'contain',
      idleTransparent: true,
      activeTransparent: false,
      inactiveImage: 'idle.png',
      activeImage: 'active.png',
    } as never;
    useKnobItemStore.setState({ positions: { '4key': [knob] } });

    await patchIdleImageFitById('knob', knobId, 'fill');
    expect(api.commitSemanticOps).toHaveBeenLastCalledWith(
      [
        {
          kind: 'patchElement',
          elementType: 'knob',
          id: knobId,
          patch: { idleImageFit: 'fill' },
        },
      ],
      expect.anything(),
    );
    await patchActiveImageFitById('knob', knobId, 'none');
    expect(api.commitSemanticOps).toHaveBeenLastCalledWith(
      [
        {
          kind: 'patchElement',
          elementType: 'knob',
          id: knobId,
          patch: { activeImageFit: 'none' },
        },
      ],
      expect.anything(),
    );
    expect(useKnobItemStore.getState().positions['4key'][0]).toMatchObject({
      imageFit: 'none',
      idleImageFit: 'fill',
      activeImageFit: 'none',
      idleTransparent: true,
      activeTransparent: false,
      inactiveImage: 'idle.png',
      activeImage: 'active.png',
    });
  });

  it('single image fit은 synthetic target을 wire 전에 거절한다', async () => {
    await expect(
      patchIdleImageFitById('graph', 'graph-0', 'cover'),
    ).resolves.toBe(false);
    await expect(
      patchActiveImageFitById('key', 'key-0', 'contain'),
    ).resolves.toBe(false);
    expect(api.commitSemanticOps).not.toHaveBeenCalled();
  });

  it('note 편입 전 실패는 자기 eager leaf만 복원한다', async () => {
    useKeyStore.setState((state) => ({
      canonicalPositions: {
        ...state.canonicalPositions,
        '4key': state.canonicalPositions['4key'].map((position) => ({
          ...position,
          noteAlignment: 'left' as const,
        })),
      },
    }));
    api.commitSemanticOps.mockRejectedValueOnce(new Error('start failed'));

    await expect(
      patchNotePropertyById(ID_A, { noteAlignment: 'right' }),
    ).rejects.toThrow('start failed');

    expect(
      useKeyStore.getState().canonicalPositions['4key'][0].noteAlignment,
    ).toBe('left');
  });
});
