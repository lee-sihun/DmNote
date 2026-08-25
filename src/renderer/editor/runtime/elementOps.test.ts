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
  lastAck: null as CanonicalEditorDocumentV1 | null,
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
import {
  registerLoadedPluginIdsProvider,
  registerStoredPluginGroupRefsProvider,
} from './pluginGroupMembers';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import {
  addGraphAt,
  addKeyAt,
  addKnobAt,
  addStatAt,
  commitBatchGeometryByIds,
  commitElementGeometryById,
  commitElementBoundsById,
  commitSingleElementBoundsById,
  deleteElementById,
  placeDuplicatedKey,
  placeDuplicatedGraph,
  placeDuplicatedKnob,
  placeDuplicatedStat,
  patchElementHiddenById,
  setLayerGroupHidden,
  setElementGroupsByTargets,
  renameLayerGroupById,
  patchElementLayerNameById,
  patchFontStyleByTargets,
  patchFontFamilyByTargets,
  patchStylePropertyById,
  patchStylePropertyByTargets,
  patchPaintByTargets,
  patchShadowByTargets,
  patchNotePaintById,
  patchNotePaintByIds,
  patchGraphPropertiesByIds,
  patchGraphTypesByIds,
  patchKnobPropertiesByIds,
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
  patchCounterFillByTargets,
  patchFontColorByTargets,
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
  patchUseInlineStylesByTargets,
  rebindKeySlotById,
} from './elementOps';

import {
  enqueueEditorCompatibilityOperation,
  enqueueEditorCompatibilityWrite,
} from './editorCompatibilityQueue';

import type {
  CanonicalEditorDocumentV1,
  CanonicalGraphItemPosition,
  EditorDocumentV1,
  EditorPatchV1,
} from '@src/types/editor';
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
): CanonicalGraphItemPosition => ({
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
let slotBase: (() => CanonicalEditorDocumentV1) | null = null;

const documentFromStores = (): CanonicalEditorDocumentV1 =>
  ({
    schemaVersion: 1,
    keys: structuredClone(useKeyStore.getState().keyMappings),
    keyPositions: structuredClone(useKeyStore.getState().canonicalPositions),
    statPositions: structuredClone(useStatItemStore.getState().positions),
    graphPositions: structuredClone(useGraphItemStore.getState().positions),
    knobPositions: structuredClone(useKnobItemStore.getState().positions),
    layerGroups: structuredClone(useLayerGroupStore.getState().layerGroups),
  } as CanonicalEditorDocumentV1);

describe('elementOps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    slotBase = null;
    api.lastAck = null;
    api.captureEditorDocument.mockImplementation(() => documentFromStores());
    // legacy patch generator 경로는 미사용 가드 - 호출 시 base만 돌려준다
    api.commitGeneratedPatch.mockImplementation(
      async (
        generate: (base: CanonicalEditorDocumentV1) => EditorPatchV1 | null,
      ) => {
        const base = (slotBase ?? documentFromStores)();
        generate(base);
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
    registerLoadedPluginIdsProvider(() => new Set());
    registerStoredPluginGroupRefsProvider(() => ({}));
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

  it('미로드 플러그인이 유일 잔존 멤버면 그룹을 유지한다', async () => {
    // 백엔드 생존 판정은 store의 전 plugin_data 인스턴스를 보므로, eager 모집단이
    // 런타임 요소만 보면 로컬에서만 그룹이 사라지고 종료 시 flush가 그 드리프트를
    // 영속화한다 (그룹 무음 영구 소실)
    registerLoadedPluginIdsProvider(() => new Set());
    registerStoredPluginGroupRefsProvider(() => ({
      'idle-plugin': { '4key': ['group-a'] },
    }));
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

    expect(useLayerGroupStore.getState().layerGroups['4key']).toEqual([
      { id: 'group-a', name: 'Group A' },
    ]);
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
          patch: { property: 'hidden', value: true },
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
      expect.objectContaining({
        id: ID_A,
        patch: { property: 'hidden', value: true },
      }),
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

  it('setElementGroups는 common4 membership과 source empty definition을 한 op로 바꾼다', async () => {
    const statId = '33333333-3333-4333-8333-333333333333';
    const graphId = '44444444-4444-4444-8444-444444444444';
    const knobId = '55555555-5555-4555-8555-555555555555';
    useKeyStore.setState({
      canonicalPositions: {
        '4key': [{ ...keyAt(ID_A), groupId: 'source', zIndex: 91 }],
      },
      positions: {
        '4key': [{ ...keyAt(ID_A), groupId: 'source', zIndex: 91 }],
      },
    });
    useStatItemStore.setState({
      positions: {
        '4key': [{ ...keyAt(statId), statType: 'kps', groupId: 'source' }],
      },
    });
    useGraphItemStore.setState({
      positions: { '4key': [{ ...graphAt(graphId), className: 'graph' }] },
    });
    useKnobItemStore.setState({
      positions: { '4key': [{ ...keyAt(knobId), className: 'knob' }] } as never,
    });
    useLayerGroupStore.setState({
      layerGroups: { '4key': [{ id: 'source', name: 'Source' }] },
    });
    const targets = [
      { elementType: 'key' as const, id: ID_A },
      { elementType: 'stat' as const, id: statId },
      { elementType: 'graph' as const, id: graphId },
      { elementType: 'knob' as const, id: knobId },
    ];

    await expect(
      setElementGroupsByTargets('4key', targets, {
        kind: 'create',
        id: 'target',
        name: 'Target',
      }),
    ).resolves.toBe(true);

    expect(useKeyStore.getState().canonicalPositions['4key'][0]).toMatchObject({
      groupId: 'target',
      zIndex: 91,
    });
    expect(useStatItemStore.getState().positions['4key'][0].groupId).toBe(
      'target',
    );
    expect(useGraphItemStore.getState().positions['4key'][0]).toMatchObject({
      groupId: 'target',
      className: 'graph',
    });
    expect(useKnobItemStore.getState().positions['4key'][0]).toMatchObject({
      groupId: 'target',
      className: 'knob',
    });
    expect(useLayerGroupStore.getState().layerGroups['4key']).toEqual([
      { id: 'target', name: 'Target' },
    ]);
    expect(api.commitSemanticOps).toHaveBeenCalledWith(
      [
        {
          kind: 'setElementGroups',
          mode: '4key',
          targets,
          targetGroup: { kind: 'create', id: 'target', name: 'Target' },
        },
      ],
      expect.objectContaining({ onEnrolled: expect.any(Function) }),
    );
  });

  it('setElementGroups create collision과 invalid target은 eager/wire 전에 fail-close한다', async () => {
    useLayerGroupStore.setState({
      layerGroups: { '4key': [{ id: 'target', name: 'Same' }] },
    });
    const before = useKeyStore.getState().canonicalPositions;
    await expect(
      setElementGroupsByTargets('4key', [{ elementType: 'key', id: ID_A }], {
        kind: 'create',
        id: 'target',
        name: 'Same',
      }),
    ).resolves.toBe(false);
    await expect(
      setElementGroupsByTargets(
        '4key',
        [{ elementType: 'key', id: 'key-0' }],
        null,
      ),
    ).resolves.toBe(false);
    expect(useKeyStore.getState().canonicalPositions).toBe(before);
    expect(api.commitSemanticOps).not.toHaveBeenCalled();
  });

  it('setElementGroups는 target 하나라도 없거나 mode가 다르면 eager와 wire를 전부 생략한다', async () => {
    useLayerGroupStore.setState({
      layerGroups: { '4key': [{ id: 'group-a', name: 'Group A' }] },
    });
    const before = useKeyStore.getState().canonicalPositions;
    await expect(
      setElementGroupsByTargets(
        '4key',
        [
          { elementType: 'key', id: ID_A },
          {
            elementType: 'stat',
            id: '33333333-3333-4333-8333-333333333333',
          },
        ],
        { kind: 'existing', id: 'group-a' },
      ),
    ).resolves.toBe(false);
    await expect(
      setElementGroupsByTargets('5key', [{ elementType: 'key', id: ID_A }], {
        kind: 'existing',
        id: 'group-a',
      }),
    ).resolves.toBe(false);

    expect(useKeyStore.getState().canonicalPositions).toBe(before);
    expect(api.commitSemanticOps).not.toHaveBeenCalled();
  });

  it('renameLayerGroup는 exact definition만 바꾸고 편입 전 실패를 복원한다', async () => {
    const before = { '4key': [{ id: 'group-a', name: 'Before' }] };
    useLayerGroupStore.setState({ layerGroups: before });
    api.commitSemanticOps.mockRejectedValueOnce(new Error('preflight'));

    await expect(
      renameLayerGroupById('4key', 'group-a', 'After'),
    ).rejects.toThrow('preflight');

    expect(useLayerGroupStore.getState().layerGroups).toBe(before);
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
          patch: { property: 'hidden', value: true },
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
          patch: { property: 'layerName', value: 'Layer A' },
        },
      ],
      expect.objectContaining({ onEnrolled: expect.any(Function) }),
    );

    await patchElementLayerNameById('key', ID_A, null);
    expect(
      useKeyStore.getState().canonicalPositions['4key'][0].layerName,
    ).toBeUndefined();
    expect(api.commitSemanticOps).toHaveBeenLastCalledWith(
      [
        expect.objectContaining({
          patch: { property: 'layerName', value: null },
        }),
      ],
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

  it('idle font color는 key와 knob의 비어 있던 active를 pre-edit idle raw로 materialize한다', async () => {
    const key = {
      ...keyAt(ID_A),
      fontColor: '  key idle raw  ',
      activeFontColor: '   ',
      className: 'key-sibling',
    };
    const knobId = 'a3999999-9999-4999-8999-999999999999';
    const knob = {
      ...keyAt(knobId),
      fontColor: '  knob idle raw  ',
      activeFontColor: undefined,
      className: 'knob-sibling',
    } as never;
    useKeyStore.setState({
      canonicalPositions: { '4key': [key] },
      positions: { '4key': [key] },
    });
    useKnobItemStore.setState({ positions: { '4key': [knob] } });

    await patchFontColorByTargets(
      [
        { elementType: 'key', id: ID_A },
        { elementType: 'knob', id: knobId },
      ],
      { property: 'fontColor', value: ' new idle ' },
    );

    expect(useKeyStore.getState().canonicalPositions['4key'][0]).toMatchObject({
      fontColor: ' new idle ',
      activeFontColor: '  key idle raw  ',
      className: 'key-sibling',
    });
    expect(useKnobItemStore.getState().positions['4key'][0]).toMatchObject({
      fontColor: ' new idle ',
      activeFontColor: '  knob idle raw  ',
      className: 'knob-sibling',
    });
  });

  it.each([
    [
      'active stat',
      [{ elementType: 'stat', id: ID_A }],
      { property: 'activeFontColor', value: '#fff' },
    ],
    [
      'active graph',
      [{ elementType: 'graph', id: ID_A }],
      { property: 'activeFontColor', value: '#fff' },
    ],
    [
      'synthetic idle',
      [{ elementType: 'key', id: 'key-0' }],
      { property: 'fontColor', value: '#fff' },
    ],
  ] as const)(
    'font color %s는 eager/wire 전에 거절한다',
    async (_label, targets, patch) => {
      await expect(
        patchFontColorByTargets(targets as never, patch as never),
      ).resolves.toBe(false);
      expect(api.commitSemanticOps).not.toHaveBeenCalled();
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
      patchGraphPropertiesByIds([ID_A, otherId], {
        property: 'graphSpeed',
        value: 2200,
      }),
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
      patchKnobPropertiesByIds([ID_A, otherId], {
        property: 'sensitivity',
        value: 3,
      }),
    ).rejects.toThrow('start failed');
    expect(
      useKnobItemStore
        .getState()
        .positions['4key'].map((position) => position.sensitivity),
    ).toEqual([1, 1]);
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

  it('font style batch는 duplicate와 empty ID를 wire 전에 거절한다', async () => {
    await expect(
      patchFontStyleByTargets(
        [
          { elementType: 'key', id: ID_A },
          { elementType: 'stat', id: ID_A },
        ],
        { property: 'fontUnderline', value: true },
      ),
    ).resolves.toBe(false);
    await expect(
      patchFontStyleByTargets([{ elementType: 'graph', id: '' }], {
        property: 'fontStrikethrough',
        value: true,
      }),
    ).resolves.toBe(false);
    expect(api.commitSemanticOps).not.toHaveBeenCalled();
  });

  it('fontFamily batch는 duplicate와 empty ID를 wire 전에 거절한다', async () => {
    await expect(
      patchFontFamilyByTargets(
        [
          { elementType: 'key', id: ID_A },
          { elementType: 'stat', id: ID_A },
        ],
        { property: 'fontFamily', value: 'Family One' },
      ),
    ).resolves.toBe(false);
    await expect(
      patchFontFamilyByTargets([{ elementType: 'graph', id: '' }], {
        property: 'fontFamily',
        value: 'Family One',
      }),
    ).resolves.toBe(false);
    expect(api.commitSemanticOps).not.toHaveBeenCalled();
  });

  it('displayText는 raw common-4 leaf와 gesture를 N ops 한 commit으로 보낸다', async () => {
    const graphId = '00000000-0000-4000-8000-0000000000d3';
    const knobId = '00000000-0000-4000-8000-0000000000d4';
    const targets = [
      { elementType: 'key' as const, id: ID_A },
      { elementType: 'stat' as const, id: ID_B },
      { elementType: 'graph' as const, id: graphId },
      { elementType: 'knob' as const, id: knobId },
    ];

    await patchStylePropertyByTargets(
      targets,
      { property: 'displayText', value: '  Raw label  ' },
      {
        gestureId: 'gesture-display',
      },
    );

    expect(api.commitSemanticOps).toHaveBeenCalledOnce();
    expect(api.commitSemanticOps.mock.calls[0]?.[0]).toEqual(
      targets.map(({ elementType, id }) => ({
        kind: 'patchElement',
        elementType,
        id,
        patch: { property: 'displayText', value: '  Raw label  ' },
      })),
    );
    expect(api.commitSemanticOps.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        gestureId: 'gesture-display',
        onEnrolled: expect.any(Function),
      }),
    );
  });

  it('className은 raw common-4 leaf와 gesture를 공용 text commit으로 보낸다', async () => {
    const targets = [
      { elementType: 'key' as const, id: ID_A },
      { elementType: 'stat' as const, id: ID_B },
    ];

    await patchStylePropertyByTargets(
      targets,
      { property: 'className', value: '  Raw class  ' },
      {
        gestureId: 'gesture-class',
      },
    );

    expect(api.commitSemanticOps).toHaveBeenCalledOnce();
    expect(api.commitSemanticOps.mock.calls[0]?.[0]).toEqual(
      targets.map(({ elementType, id }) => ({
        kind: 'patchElement',
        elementType,
        id,
        patch: { property: 'className', value: '  Raw class  ' },
      })),
    );
    expect(api.commitSemanticOps.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        gestureId: 'gesture-class',
        onEnrolled: expect.any(Function),
      }),
    );
  });

  it.each([
    [{ property: 'borderWidth', value: 12.5 }, 'gesture-border-width'],
    [{ property: 'borderRadius', value: 88.5 }, 'gesture-border-radius'],
    [{ property: 'fontSize', value: 31.5 }, 'gesture-font-size'],
  ] as const)(
    '%j numeric style은 exact leaf와 gesture를 한 commit으로 보낸다',
    async (patch, gestureId) => {
      await patchStylePropertyByTargets(
        [{ elementType: 'key', id: ID_A }],
        patch,
        { gestureId },
      );

      expect(api.commitSemanticOps).toHaveBeenCalledWith(
        [
          {
            kind: 'patchElement',
            elementType: 'key',
            id: ID_A,
            patch,
          },
        ],
        expect.objectContaining({
          gestureId,
          onEnrolled: expect.any(Function),
        }),
      );
    },
  );

  it('noteGlowSize는 key-only exact leaf와 gesture로 sibling을 보존한다', async () => {
    const before = {
      ...keyAt(ID_A),
      noteGlowSize: 20,
      noteGlowEnabled: true,
      noteGlowColor: '#sentinel',
    };
    useKeyStore.setState({
      canonicalPositions: { '4key': [before] },
      positions: { '4key': [before] },
    });
    api.captureEditorDocument.mockImplementation(documentFromStores);

    await patchStylePropertyByTargets(
      [{ elementType: 'key', id: ID_A }],
      { property: 'noteGlowSize', value: 20.5 },
      { gestureId: 'gesture-note-glow' },
    );

    expect(api.commitSemanticOps).toHaveBeenCalledWith(
      [
        {
          kind: 'patchElement',
          elementType: 'key',
          id: ID_A,
          patch: { property: 'noteGlowSize', value: 20.5 },
        },
      ],
      expect.objectContaining({
        gestureId: 'gesture-note-glow',
        onEnrolled: expect.any(Function),
      }),
    );
    expect(useKeyStore.getState().canonicalPositions['4key'][0]).toMatchObject({
      noteGlowSize: 20.5,
      noteGlowEnabled: true,
      noteGlowColor: '#sentinel',
    });
  });

  it.each([
    ['wrong type', [{ elementType: 'stat' as const, id: ID_B }], 20],
    ['negative', [{ elementType: 'key' as const, id: ID_A }], -0.1],
    ['over max', [{ elementType: 'key' as const, id: ID_A }], 50.1],
    ['nonfinite', [{ elementType: 'key' as const, id: ID_A }], Infinity],
  ])('noteGlowSize %s는 wire 전에 거절한다', async (_label, targets, value) => {
    await expect(
      patchStylePropertyByTargets(targets, {
        property: 'noteGlowSize',
        value: value,
      }),
    ).resolves.toBe(false);
    expect(api.commitSemanticOps).not.toHaveBeenCalled();
  });

  it('note numeric 5종은 nullable exact leaf와 key sibling을 보존한다', async () => {
    const before = {
      ...keyAt(ID_A),
      noteOffsetX: 7.5,
      noteOffsetY: -8.5,
      noteWidth: 42.5,
      noteBorderWidth: 2.5,
      noteBorderRadius: 11.5,
      noteColor: '#sentinel',
      noteGlowSize: 17.5,
    };
    useKeyStore.setState({
      canonicalPositions: { '4key': [before] },
      positions: { '4key': [before] },
    });
    api.captureEditorDocument.mockImplementation(documentFromStores);
    const patches = [
      { property: 'noteOffsetX', value: null },
      { property: 'noteOffsetY', value: 0 },
      { property: 'noteWidth', value: null },
      { property: 'noteBorderWidth', value: 3.5 },
      { property: 'noteBorderRadius', value: 12.5 },
    ] as const;

    for (const patch of patches) {
      await patchStylePropertyByTargets(
        [{ elementType: 'key', id: ID_A }],
        patch,
        { gestureId: 'gesture-note-numeric' },
      );
    }

    expect(api.commitSemanticOps).toHaveBeenCalledTimes(5);
    expect(
      api.commitSemanticOps.mock.calls.map(([ops]) => ops[0]?.patch),
    ).toEqual(patches);
    expect(useKeyStore.getState().canonicalPositions['4key'][0]).toMatchObject({
      noteOffsetX: undefined,
      noteOffsetY: 0,
      noteWidth: undefined,
      noteBorderWidth: 3.5,
      noteBorderRadius: 12.5,
      noteColor: '#sentinel',
      noteGlowSize: 17.5,
    });
  });

  it.each(['stale', ''])(
    'idle background paint는 gradient 대표색으로 active fallback을 materialize한다 (%j)',
    async (idleColor) => {
      const gradient = {
        angle: 45,
        stops: [
          { color: '#first', pos: 0 },
          { color: '#last', pos: 1 },
        ],
      };
      const before = {
        ...keyAt(ID_A),
        backgroundColor: idleColor,
        backgroundGradient: gradient,
        activeBackgroundColor: undefined,
        activeBackgroundGradient: undefined,
        borderColor: '#border-sibling',
      };
      useKeyStore.setState({
        canonicalPositions: { '4key': [before] },
        positions: { '4key': [before] },
      });
      api.captureEditorDocument.mockReturnValue(documentFromStores());

      await patchPaintByTargets([{ elementType: 'key', id: ID_A }], {
        property: 'backgroundPaint',
        value: { color: '#next', gradient: null },
      });

      expect(
        useKeyStore.getState().canonicalPositions['4key'][0],
      ).toMatchObject({
        backgroundColor: '#next',
        backgroundGradient: undefined,
        activeBackgroundColor: '#first',
        activeBackgroundGradient: gradient,
        borderColor: '#border-sibling',
      });
      expect(api.commitSemanticOps).toHaveBeenLastCalledWith(
        [
          {
            kind: 'patchElement',
            elementType: 'key',
            id: ID_A,
            patch: {
              property: 'backgroundPaint',
              value: { color: '#next', gradient: null },
            },
          },
        ],
        expect.anything(),
      );
    },
  );

  it('shadow partial과 master는 fresh siblings와 stat active 부재를 보존한다', async () => {
    const key = {
      ...keyAt(ID_A),
      inactiveImage: 'image.png',
      shadow: undefined,
      activeShadow: undefined,
      borderColor: '#sibling',
    };
    const stat = {
      ...keyAt(ID_B),
      statType: 'kps' as const,
      shadow: undefined,
      activeShadow: undefined,
      borderColor: '#stat-sibling',
    };
    useKeyStore.setState({
      canonicalPositions: { '4key': [key] },
      positions: { '4key': [key] },
    });
    useStatItemStore.setState({ positions: { '4key': [stat] } });
    api.captureEditorDocument.mockImplementation(documentFromStores);

    await patchShadowByTargets([{ elementType: 'key', id: ID_A }], {
      property: 'shadow',
      value: { leaf: 'blur', value: 22 },
    });
    await patchShadowByTargets(
      [
        { elementType: 'key', id: ID_A },
        { elementType: 'stat', id: ID_B },
      ],
      { property: 'shadowEnabled', value: false },
    );

    expect(useKeyStore.getState().canonicalPositions['4key'][0]).toMatchObject({
      shadow: {
        enabled: false,
        color: 'rgba(0, 0, 0, 0.28)',
        offsetX: 0,
        offsetY: 4,
        blur: 22,
      },
      activeShadow: {
        enabled: false,
        color: 'rgba(0, 0, 0, 0.32)',
        offsetX: 0,
        offsetY: 3,
        blur: 8,
      },
      borderColor: '#sibling',
    });
    expect(useStatItemStore.getState().positions['4key'][0]).toMatchObject({
      shadow: { enabled: false },
      borderColor: '#stat-sibling',
    });
    expect(
      useStatItemStore.getState().positions['4key'][0].activeShadow,
    ).toBeUndefined();
  });

  it('counter fill은 state pair만 바꾸고 opposite와 raw counter siblings를 보존한다', async () => {
    const gradient = {
      angle: 45,
      stops: [
        { color: '#112233', pos: 0 },
        { color: '#445566', pos: 1 },
      ],
    };
    const key = {
      ...keyAt(ID_A),
      counter: {
        ...keyAt(ID_A).counter,
        fill: { idle: 'idle-before', active: 'active-before' },
        fillIdleGradient: gradient,
        fillActiveGradient: gradient,
        customSibling: 'raw-sibling',
      },
    } as never;
    useKeyStore.setState({
      canonicalPositions: { '4key': [key] },
      positions: { '4key': [key] },
    });

    await patchCounterFillByTargets([{ elementType: 'key', id: ID_A }], {
      property: 'counterFillIdle',
      value: { color: ' solid final ' },
    });

    expect(
      useKeyStore.getState().canonicalPositions['4key'][0].counter,
    ).toMatchObject({
      fill: { idle: ' solid final ', active: 'active-before' },
      fillActiveGradient: gradient,
      customSibling: 'raw-sibling',
    });
    expect(
      useKeyStore.getState().canonicalPositions['4key'][0].counter
        .fillIdleGradient,
    ).toBeUndefined();
    expect(api.commitSemanticOps).toHaveBeenCalledWith(
      [
        {
          kind: 'patchElement',
          elementType: 'key',
          id: ID_A,
          patch: {
            property: 'counterFillIdle',
            value: { color: ' solid final ' },
          },
        },
      ],
      expect.anything(),
    );
  });

  it.each([
    [
      'idle graph',
      [{ elementType: 'graph', id: ID_A }],
      { property: 'counterFillIdle', value: { color: '#fff' } },
    ],
    [
      'active stat',
      [{ elementType: 'stat', id: ID_A }],
      { property: 'counterFillActive', value: { color: '#fff' } },
    ],
    [
      'synthetic',
      [{ elementType: 'key', id: 'key-0' }],
      { property: 'counterFillIdle', value: { color: '#fff' } },
    ],
  ] as const)(
    'counter fill %s는 eager/wire 전에 거절한다',
    async (_label, targets, patch) => {
      await expect(
        patchCounterFillByTargets(targets as never, patch as never),
      ).resolves.toBe(false);
      expect(api.commitSemanticOps).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      'graph',
      [{ elementType: 'graph' as const, id: ID_A }],
      { property: 'shadow', value: { leaf: 'blur', value: 1 } },
    ],
    [
      'active stat',
      [{ elementType: 'stat' as const, id: ID_B }],
      { property: 'activeShadow', value: { leaf: 'blur', value: 1 } },
    ],
    [
      'empty color',
      [{ elementType: 'key' as const, id: ID_A }],
      { property: 'shadow', value: { leaf: 'color', value: '' } },
    ],
    [
      'range',
      [{ elementType: 'key' as const, id: ID_A }],
      { property: 'shadow', value: { leaf: 'offsetX', value: 101 } },
    ],
  ] as const)(
    'shadow %s는 wire 전에 거절한다',
    async (_label, targets, patch) => {
      await expect(
        patchShadowByTargets(targets as never, patch as never),
      ).resolves.toBe(false);
      expect(api.commitSemanticOps).not.toHaveBeenCalled();
    },
  );

  it('note paint exact mask는 요청 leaf만 eager 투영하고 gesture를 wire에 보존한다', async () => {
    const key = {
      ...keyAt(ID_A),
      noteColor: 'idle-color',
      noteOpacity: 80,
      noteOpacityTop: 70,
      noteOpacityBottom: 60,
      noteGlowColor: 'glow-sibling',
      noteGlowOpacity: 50,
      noteGlowOpacityTop: 40,
      noteGlowOpacityBottom: 30,
      noteBorderColor: '#112233',
      noteBorderOpacity: 20,
      className: 'sibling',
    };
    useKeyStore.setState({
      canonicalPositions: { '4key': [key] },
      positions: { '4key': [key] },
    });

    await patchNotePaintByIds(
      [ID_A],
      { property: 'noteGlowPaint', value: { opacity: 77 } },
      { gestureId: '00000000-0000-4000-8000-000000000077' },
    );

    expect(useKeyStore.getState().canonicalPositions['4key'][0]).toMatchObject({
      noteColor: 'idle-color',
      noteOpacity: 80,
      noteOpacityTop: 70,
      noteOpacityBottom: 60,
      noteGlowColor: 'glow-sibling',
      noteGlowOpacity: 77,
      noteGlowOpacityTop: 40,
      noteGlowOpacityBottom: 30,
      noteBorderColor: '#112233',
      noteBorderOpacity: 20,
      className: 'sibling',
    });
    expect(api.commitSemanticOps).toHaveBeenCalledWith(
      [
        {
          kind: 'patchElement',
          elementType: 'key',
          id: ID_A,
          patch: { property: 'noteGlowPaint', value: { opacity: 77 } },
        },
      ],
      expect.objectContaining({
        gestureId: '00000000-0000-4000-8000-000000000077',
      }),
    );

    await patchNotePaintById(ID_A, {
      property: 'notePaint',
      value: { opacity: 66, opacityTop: 55, opacityBottom: 44 },
    });
    expect(useKeyStore.getState().canonicalPositions['4key'][0]).toMatchObject({
      noteOpacity: 66,
      noteOpacityTop: 55,
      noteOpacityBottom: 44,
      noteGlowOpacity: 77,
    });
  });

  it.each([
    [
      'synthetic',
      ['key-0'],
      { property: 'notePaint', value: { color: '#fff' } },
    ],
    ['empty', [], { property: 'notePaint', value: { opacity: 50 } }],
    [
      'duplicate',
      [ID_A, ID_A],
      { property: 'notePaint', value: { opacity: 50 } },
    ],
    [
      'combined',
      [ID_A],
      { property: 'notePaint', value: { color: '#fff', opacity: 50 } },
    ],
    [
      'border color',
      [ID_A],
      { property: 'noteBorderPaint', value: { color: '#fff', opacity: 50 } },
    ],
  ] as const)(
    'note paint %s는 wire 전에 거절한다',
    async (_label, ids, patch) => {
      await expect(patchNotePaintByIds([...ids], patch as never)).resolves.toBe(
        false,
      );
      expect(api.commitSemanticOps).not.toHaveBeenCalled();
    },
  );

  it('note paint 편입 전 실패는 자기 eager leaf만 복원한다', async () => {
    const key = {
      ...keyAt(ID_A),
      noteOpacity: 80,
      noteOpacityTop: 70,
      noteOpacityBottom: 60,
      noteGlowColor: 'fresh-sibling',
    };
    useKeyStore.setState({
      canonicalPositions: { '4key': [key] },
      positions: { '4key': [key] },
    });
    api.commitSemanticOps.mockRejectedValueOnce(new Error('start failed'));

    await expect(
      patchNotePaintById(ID_A, {
        property: 'notePaint',
        value: { opacity: 99 },
      }),
    ).rejects.toThrow('start failed');
    expect(useKeyStore.getState().canonicalPositions['4key'][0]).toMatchObject({
      noteOpacity: 80,
      noteOpacityTop: 70,
      noteOpacityBottom: 60,
      noteGlowColor: 'fresh-sibling',
    });
  });

  it.each([
    ['wrong type', 'stat', { property: 'noteOffsetX', value: 0 }],
    ['offset range', 'key', { property: 'noteOffsetY', value: 500.1 }],
    ['width zero', 'key', { property: 'noteWidth', value: 0 }],
    ['border width range', 'key', { property: 'noteBorderWidth', value: 20.1 }],
    [
      'border radius range',
      'key',
      { property: 'noteBorderRadius', value: 0.9 },
    ],
  ] as const)(
    'note numeric %s는 wire 전에 거절한다',
    async (_label, elementType, patch) => {
      await expect(
        patchStylePropertyByTargets([{ elementType, id: ID_A }], patch),
      ).resolves.toBe(false);
      expect(api.commitSemanticOps).not.toHaveBeenCalled();
    },
  );

  it('displayText는 invalid target을 wire 전에 거절하고 편입 전 실패를 복원한다', async () => {
    await expect(
      patchStylePropertyByTargets(
        [
          { elementType: 'key', id: ID_A },
          { elementType: 'graph', id: ID_A },
        ],
        { property: 'displayText', value: '' },
      ),
    ).resolves.toBe(false);
    await expect(
      patchStylePropertyByTargets([{ elementType: 'knob', id: 'knob-0' }], {
        property: 'displayText',
        value: '',
      }),
    ).resolves.toBe(false);
    expect(api.commitSemanticOps).not.toHaveBeenCalled();

    api.commitSemanticOps.mockRejectedValueOnce(new Error('start failed'));
    await expect(
      patchStylePropertyById('key', ID_A, {
        property: 'displayText',
        value: 'After',
      }),
    ).rejects.toThrow('start failed');
    expect(
      useKeyStore.getState().canonicalPositions['4key'][0].displayText,
    ).toBeUndefined();
  });

  it('note batch는 duplicate와 empty ID를 wire 전에 거절한다', async () => {
    await expect(
      patchNotePropertiesByIds([ID_A, ID_A], {
        property: 'noteAlignment',
        value: 'center',
      }),
    ).resolves.toBe(false);
    await expect(
      patchNotePropertiesByIds([''], {
        property: 'noteGlowEnabled',
        value: true,
      }),
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
          patch: { property: 'axisId', value: '  HIDA:raw  ' },
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
          patch: { property: 'soundPath', value: '  sounds/raw.wav  ' },
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
        patch: { property: 'soundPath', value: '' },
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
          patch: { property: 'soundEnabled', value: true },
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
        patch: { property: 'soundEnabled', value: true },
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
          patch: { property: 'soundVolume', value: 137.5 },
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
        patch: { property: 'soundVolume', value: 200 },
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
            property: 'counterAnimationPreset',
            value: {
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
            property: 'counterAnimationPreset',
            value: { presetId: 'preset-a', scale: 1.4 },
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
        patch: { property: 'counterEnabled', value: true },
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
        patch: { property: 'counterAnimationEnabled', value: true },
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
      canonicalPositions: {
        '4key': [
          {
            ...keyAt(ID_A),
            fontFamily: 'Top Level Family',
            counter: rawCounter,
          },
        ],
      },
      positions: {
        '4key': [
          {
            ...keyAt(ID_A),
            fontFamily: 'Top Level Family',
            counter: rawCounter,
          },
        ],
      },
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
      { property: 'counterPlacement', value: 'outside' as const },
      { property: 'counterAlign', value: 'right' as const },
      { property: 'counterAlignMode', value: 'center' as const },
      { property: 'counterGap', value: 4_294_967_295 },
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
      patchCounterLayoutByTargets([], { property: 'counterGap', value: 2 }),
    ).resolves.toBe(false);
    await expect(
      patchCounterLayoutByTargets(
        [
          { elementType: 'key', id: ID_A },
          { elementType: 'stat', id: ID_A },
        ],
        { property: 'counterAlign', value: 'top' },
      ),
    ).resolves.toBe(false);
    await expect(
      patchCounterLayoutByTargets([{ elementType: 'key', id: 'key-0' }], {
        property: 'counterPlacement',
        value: 'inside',
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
      canonicalPositions: {
        '4key': [
          {
            ...keyAt(ID_A),
            fontFamily: 'Top Level Family',
            counter: rawCounter,
          },
        ],
      },
      positions: {
        '4key': [
          {
            ...keyAt(ID_A),
            fontFamily: 'Top Level Family',
            counter: rawCounter,
          },
        ],
      },
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
      { property: 'counterFontSize', value: 72 },
      { property: 'counterFontWeight', value: 900 },
      { property: 'counterFontItalic', value: true },
      { property: 'counterFontUnderline', value: true },
      { property: 'counterFontStrikethrough', value: true },
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
      patchCounterTypographyByTargets([], {
        property: 'counterFontSize',
        value: 8,
      }),
    ).resolves.toBe(false);
    await expect(
      patchCounterTypographyByTargets(
        [
          { elementType: 'key', id: ID_A },
          { elementType: 'stat', id: ID_A },
        ],
        { property: 'counterFontWeight', value: 400 },
      ),
    ).resolves.toBe(false);
    await expect(
      patchCounterTypographyByTargets([{ elementType: 'key', id: 'key-0' }], {
        property: 'counterFontItalic',
        value: true,
      }),
    ).resolves.toBe(false);
    await expect(
      patchCounterTypographyByTargets([{ elementType: 'key', id: ID_A }], {
        property: 'counterFontSize',
        value: 7,
      }),
    ).resolves.toBe(false);
    await expect(
      patchCounterTypographyByTargets([{ elementType: 'key', id: ID_A }], {
        property: 'counterFontWeight',
        value: 400.5,
      }),
    ).resolves.toBe(false);
    expect(api.commitSemanticOps).not.toHaveBeenCalled();
  });

  it('counter fontFamily raw string은 siblings를 보존해 key/stat N ops 한 commit으로 보낸다', async () => {
    const statId = '33333333-3333-4333-8333-333333333333';
    const rawCounter = {
      ...createDefaultKeyPosition().counter,
      fontFamily: 'Before',
      customSentinel: 'keep-raw',
    };
    useKeyStore.setState({
      canonicalPositions: {
        '4key': [
          {
            ...keyAt(ID_A),
            fontFamily: 'Top Level Family',
            counter: rawCounter,
          },
        ],
      },
      positions: {
        '4key': [
          {
            ...keyAt(ID_A),
            fontFamily: 'Top Level Family',
            counter: rawCounter,
          },
        ],
      },
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
    api.captureEditorDocument.mockReturnValue(documentFromStores());

    await patchCounterTypographyByTargets(targets, {
      property: 'counterFontFamily',
      value: '  Raw Counter Family  ',
    });

    expect(api.commitSemanticOps).toHaveBeenCalledWith(
      targets.map(({ elementType, id }) => ({
        kind: 'patchElement',
        elementType,
        id,
        patch: {
          property: 'counterFontFamily',
          value: '  Raw Counter Family  ',
        },
      })),
      expect.anything(),
    );
    expect(useKeyStore.getState().canonicalPositions['4key'][0]).toMatchObject({
      fontFamily: 'Top Level Family',
      counter: {
        fontFamily: '  Raw Counter Family  ',
        customSentinel: 'keep-raw',
      },
    });
  });

  it('counter fontFamily는 empty, duplicate, synthetic target을 wire 전에 거절한다', async () => {
    await expect(
      patchCounterTypographyByTargets([], {
        property: 'counterFontFamily',
        value: '',
      }),
    ).resolves.toBe(false);
    await expect(
      patchCounterTypographyByTargets(
        [
          { elementType: 'key', id: ID_A },
          { elementType: 'stat', id: ID_A },
        ],
        { property: 'counterFontFamily', value: 'Counter' },
      ),
    ).resolves.toBe(false);
    await expect(
      patchCounterTypographyByTargets([{ elementType: 'key', id: 'key-0' }], {
        property: 'counterFontFamily',
        value: 'Counter',
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
          patch: { property: 'inactiveImage', value: '  /tmp/raw.png  ' },
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
        patch: { property: 'inactiveImage', value: 'picked.png' },
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
          patch: { property: 'activeImage', value: '  /tmp/raw active.png  ' },
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
        patch: { property: 'activeImage', value: '' },
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
          patch: { property: 'idleTransparent', value: true },
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
          patch: { property: 'activeTransparent', value: true },
        },
        {
          kind: 'patchElement',
          elementType: 'knob',
          id: knobId,
          patch: { property: 'activeTransparent', value: true },
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
          patch: { property: 'idleImageFit', value: 'fill' },
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
          patch: { property: 'activeImageFit', value: 'none' },
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
});

// 분리 속성 패널 창의 커밋 경로. 즉시 반영이 없으면 낙관 커밋이 해제되는
// 프레임에 값이 옛 canonical로 되돌아갔다가 editor:committed 도착 때
// 다시 바뀌어 토글이 버벅인다
