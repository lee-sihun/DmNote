import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultKeyPosition } from '../model/keys';

const api = vi.hoisted(() => ({
  commitGeneratedPatch: vi.fn(),
  commitSemanticOps: vi.fn(),
}));

vi.mock('./editorStateCoordinator', () => ({
  editorCoordinator: { commitGeneratedPatch: api.commitGeneratedPatch },
}));

vi.mock('./editorSemanticOps', () => ({
  commitSemanticOps: api.commitSemanticOps,
}));

import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import {
  applyZOrderByIds,
  commitElementBoundsById,
  commitSingleElementBoundsById,
  commitSelectedGeometryByIds,
  deleteElementById,
  placeDuplicatedKey,
  rebindKeySlotById,
} from './elementOps';

import { enqueueEditorCompatibilityWrite } from './editorCompatibilityQueue';

import type { EditorDocumentV1, EditorPatchV1 } from '@src/types/editor';

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';

const keyAt = (id: string, zIndex?: number) => ({
  ...createDefaultKeyPosition(),
  id,
  ...(zIndex !== undefined ? { zIndex } : {}),
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
    layerGroups: {},
  } as unknown as EditorDocumentV1);

describe('elementOps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    slotBase = null;
    generatedPatches.length = 0;
    api.commitGeneratedPatch.mockImplementation(
      async (generate: (base: EditorDocumentV1) => EditorPatchV1 | null) => {
        const base = (slotBase ?? documentFromStores)();
        generatedPatches.push(generate(base));
        return base;
      },
    );
    api.commitSemanticOps.mockImplementation(async (_ops, meta) => {
      meta?.onEnrolled?.();
      return {
        document: documentFromStores(),
        opResults: _ops.map((op) => ({
          status: 'applied',
          bounds: op.bounds,
        })),
      };
    });
    useKeyStore.setState({
      selectedKeyType: '4key',
      keyMappings: { '4key': ['A', 'B'] },
      canonicalPositions: { '4key': [keyAt(ID_A), keyAt(ID_B)] },
      positions: { '4key': [keyAt(ID_A), keyAt(ID_B)] },
    });
    useStatItemStore.setState({ positions: {} });
    useGraphItemStore.setState({ positions: {} });
    useKnobItemStore.setState({ positions: {} });
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
    // wire: paired 제거
    const patch = generatedPatches[0];
    expect(patch?.keys?.['4key']).toEqual(['B']);
    expect(patch?.keyPositions?.['4key'].map((p) => p.id)).toEqual([ID_B]);
  });

  it('삭제 확정 시점에 재정렬돼 있어도 같은 id를 제거한다', async () => {
    slotBase = () => {
      const base = documentFromStores();
      base.keys = { '4key': ['B', 'A'] };
      base.keyPositions = { '4key': [keyAt(ID_B), keyAt(ID_A)] } as never;
      return base;
    };

    await deleteElementById('key', ID_A);

    const patch = generatedPatches[0];
    expect(patch?.keys?.['4key']).toEqual(['B']);
    expect(patch?.keyPositions?.['4key'].map((p) => p.id)).toEqual([ID_B]);
  });

  it('확정 시점에 이미 삭제된 대상은 커밋하지 않는다', async () => {
    slotBase = () => {
      const base = documentFromStores();
      base.keys = { '4key': ['B'] };
      base.keyPositions = { '4key': [keyAt(ID_B)] } as never;
      return base;
    };

    await deleteElementById('key', ID_A);

    expect(generatedPatches).toEqual([null]);
  });

  it('복제 배치는 동결 payload를 새 id로 추가한다', async () => {
    const frozen = {
      slot: 'A',
      position: keyAt(ID_A),
    };

    const pre = documentFromStores();
    slotBase = () => pre;
    await placeDuplicatedKey(frozen, '4key', 10, 20);

    const patch = generatedPatches[0];
    expect(patch?.keys?.['4key']).toEqual(['A', 'B', 'A']);
    const added = patch?.keyPositions?.['4key'][2];
    expect(added?.dx).toBe(10);
    expect(added?.dy).toBe(20);
    expect(added?.id).toBeTruthy();
    expect(added?.id).not.toBe(ID_A);
    // eager 반영
    expect(useKeyStore.getState().keyMappings['4key']).toHaveLength(3);
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

  it('슬롯 재바인딩은 same-shape 재정렬에도 위치 id의 paired index를 따라간다', async () => {
    slotBase = () => {
      const base = documentFromStores();
      base.keys = { '4key': ['B', 'A'] };
      base.keyPositions = { '4key': [keyAt(ID_B), keyAt(ID_A)] } as never;
      return base;
    };

    const applied = await rebindKeySlotById(ID_A, 'Z');

    expect(applied).toBe(true);
    // eager: 호출 시점 스토어 기준 index 0 (ID_A 위치)
    expect(useKeyStore.getState().keyMappings['4key']).toEqual(['Z', 'B']);
    // wire: 재정렬된 base에서 ID_A는 index 1 - 그 자리의 슬롯이 바뀐다
    const patch = generatedPatches[0];
    expect(patch?.keys?.['4key']).toEqual(['B', 'Z']);
    expect(patch?.keyPositions).toBeUndefined();
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
    api.commitGeneratedPatch.mockRejectedValue(new Error('start failed'));

    await expect(deleteElementById('key', ID_A)).rejects.toThrow(
      'start failed',
    );

    expect(useKeyStore.getState().keyMappings['4key']).toEqual(['A', 'B']);
    expect(
      useKeyStore.getState().canonicalPositions['4key'].map((p) => p.id),
    ).toEqual([ID_A, ID_B]);
  });

  it('복제의 편입 전 실패는 추가한 pair를 제거한다', async () => {
    api.commitGeneratedPatch.mockRejectedValue(new Error('start failed'));

    await expect(
      placeDuplicatedKey({ slot: 'A', position: keyAt(ID_A) }, '4key', 1, 2),
    ).rejects.toThrow('start failed');

    expect(useKeyStore.getState().keyMappings['4key']).toEqual(['A', 'B']);
    expect(useKeyStore.getState().canonicalPositions['4key']).toHaveLength(2);
  });

  it('재바인딩의 편입 전 실패는 슬롯을 복원한다', async () => {
    api.commitGeneratedPatch.mockRejectedValue(new Error('start failed'));

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
    await Promise.resolve();
    await Promise.resolve();
    // 큐를 건너뛰면 여기서 이미 커밋된다
    expect(api.commitGeneratedPatch).not.toHaveBeenCalled();

    release();
    await first;
    expect(await pending).toBe(true);
    expect(api.commitGeneratedPatch).toHaveBeenCalledOnce();
  });

  it('재바인딩 대상이 사라졌으면 커밋하지 않는다', async () => {
    slotBase = () => {
      const base = documentFromStores();
      base.keys = { '4key': ['B'] };
      base.keyPositions = { '4key': [keyAt(ID_B)] } as never;
      return base;
    };

    await rebindKeySlotById(ID_A, 'Z');

    expect(generatedPatches).toEqual([null]);
  });
});
