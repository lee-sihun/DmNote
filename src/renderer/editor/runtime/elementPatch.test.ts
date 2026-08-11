import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultKeyPosition } from '../model/keys';

import type { KeyPositions } from '@src/types/key/keys';
import type { StatItemPosition } from '@src/types/key/statItems';

const api = vi.hoisted(() => ({
  updatePositionsWithGesture: vi.fn(
    async (_positions: KeyPositions, _gestureId?: string) => ({}),
  ),
  updateMappingsAndPositionsWithGesture: vi.fn(async () => ({})),
  commitGeneratedPatch: vi.fn(),
}));

vi.mock('./editorStateCoordinator', () => ({
  editorCoordinator: { commitGeneratedPatch: api.commitGeneratedPatch },
}));

vi.mock('@api/modules/keysApi', () => ({
  updatePositionsWithGesture: api.updatePositionsWithGesture,
  updateMappingsAndPositionsWithGesture:
    api.updateMappingsAndPositionsWithGesture,
}));
vi.mock('@api/modules/editorApi', () => ({
  editorApi: {
    get: vi.fn(),
    commit: vi.fn(),
    onCommitted: vi.fn(() =>
      Object.assign(() => {}, { ready: Promise.resolve() }),
    ),
  },
}));
vi.mock('@api/modules/previewApi', () => ({
  previewApi: {
    cancel: vi.fn(async () => {}),
    publish: vi.fn(async () => {}),
    subscribe: vi.fn(async () => 1),
  },
}));

import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { enqueueEditorCompatibilityWrite } from './editorCompatibilityQueue';
import { applyElementPatchById, applyElementPatchesById } from './elementPatch';
import { editGestureController } from './editGestureController';

import type { EditorDocumentV1, EditorPatchV1 } from '@src/types/editor';
import type { GraphItemPosition } from '@src/types/key/graphItems';

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const ID_S = '33333333-3333-4333-8333-333333333333';
const ID_GONE = '99999999-9999-4999-8999-999999999999';

const keyAt = (id: string) => ({ ...createDefaultKeyPosition(), id });

// 슬롯 시점 base 문서. 기본은 호출 시점 스토어 상태 - 테스트가 대기 중
// 정산(재정렬·삭제·병행 변경)을 시뮬레이션하려면 slotBase를 지정한다
let slotBase: (() => EditorDocumentV1) | null = null;

const documentFromStores = (): EditorDocumentV1 => ({
  schemaVersion: 1,
  keys: {},
  keyPositions: structuredClone(useKeyStore.getState().canonicalPositions),
  statPositions: structuredClone(useStatItemStore.getState().positions),
  graphPositions: structuredClone(useGraphItemStore.getState().positions),
  knobPositions: structuredClone(useKnobItemStore.getState().positions),
  layerGroups: {},
});

const generatedPatches: Array<EditorPatchV1 | null> = [];

describe('applyElementPatchById', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    slotBase = null;
    generatedPatches.length = 0;
    api.commitGeneratedPatch.mockImplementation(
      async (generate: (base: EditorDocumentV1) => EditorPatchV1 | null) => {
        const base = (slotBase ?? documentFromStores)();
        const patch = generate(base);
        generatedPatches.push(patch);
        return base;
      },
    );
    editGestureController.cancel();
    useKeyStore.setState({
      selectedKeyType: '4key',
      canonicalPositions: { '4key': [keyAt(ID_A), keyAt(ID_B)] },
      positions: { '4key': [keyAt(ID_A), keyAt(ID_B)] },
    });
    useStatItemStore.setState({ positions: {} });
    useGraphItemStore.setState({ positions: {} });
    useKnobItemStore.setState({ positions: {} });
  });

  it('클릭 시점에 스토어에 즉시 반영한다', () => {
    void applyElementPatchById('key', ID_A, () => ({
      inactiveImage: 'picked.png',
    }));

    // await 전 단언 - 이후의 full-record 캡처가 이 값을 포함해야 한다
    expect(
      useKeyStore.getState().canonicalPositions['4key'][0].inactiveImage,
    ).toBe('picked.png');
  });

  it('재정렬 뒤에도 id가 가리키는 요소의 현재 index에 적용한다', async () => {
    const [a, b] = useKeyStore.getState().canonicalPositions['4key'];
    useKeyStore.getState().setPositions({ '4key': [b, a] });

    const applied = await applyElementPatchById('key', ID_A, () => ({
      inactiveImage: 'picked.png',
    }));

    expect(applied).toBe(true);
    const patch = generatedPatches[0];
    expect(patch?.keyPositions?.['4key'][1].inactiveImage).toBe('picked.png');
    expect(patch?.keyPositions?.['4key'][0].inactiveImage ?? '').toBe('');
    expect(
      useKeyStore.getState().canonicalPositions['4key'][1].inactiveImage,
    ).toBe('picked.png');
  });

  it('대기 중 재정렬은 슬롯 시점 문서에서 재해석하고 병행 변경을 보존한다', async () => {
    // 클릭 시점 순서는 [A, B]. 대기 중 [B, A]로 재정렬되고 B에 병행
    // 변경(noteWidth 222)이 정산된 상황
    slotBase = () => {
      const base = documentFromStores();
      const [first, second] = base.keyPositions['4key'];
      base.keyPositions['4key'] = [{ ...second, noteWidth: 222 }, first];
      return base;
    };

    const applied = await applyElementPatchById('key', ID_A, () => ({
      inactiveImage: 'picked.png',
    }));

    expect(applied).toBe(true);
    const record = generatedPatches[0]?.keyPositions?.['4key'];
    expect(record?.[1].id).toBe(ID_A);
    expect(record?.[1].inactiveImage).toBe('picked.png');
    // 병행 변경은 그대로 - 클릭 시점 캡처였다면 222가 사라진다
    expect(record?.[0].id).toBe(ID_B);
    expect(record?.[0].noteWidth).toBe(222);
    expect(record?.[0].inactiveImage ?? '').toBe('');
  });

  it('보고 있는 모드가 바뀌어도 원 모드 컬렉션에 적용한다', async () => {
    const stat = {
      ...createDefaultKeyPosition(),
      id: ID_S,
      statType: 'kps',
    } as StatItemPosition;
    useStatItemStore.setState({ positions: { '4key': [stat] } });
    useKeyStore.setState({ selectedKeyType: '8key' });

    const applied = await applyElementPatchById('stat', ID_S, () => ({
      inactiveImage: 'picked.png',
    }));

    expect(applied).toBe(true);
    expect(generatedPatches[0]?.statPositions?.['4key'][0].inactiveImage).toBe(
      'picked.png',
    );
    expect(useStatItemStore.getState().positions['4key'][0].inactiveImage).toBe(
      'picked.png',
    );
  });

  it('요소가 삭제됐으면 아무것도 쓰지 않는다', async () => {
    const before = structuredClone(useKeyStore.getState().canonicalPositions);

    const applied = await applyElementPatchById('key', ID_GONE, () => ({
      inactiveImage: 'picked.png',
    }));

    expect(applied).toBe(false);
    // 슬롯 재판정까지 가되 wire에는 아무것도 싣지 않는다
    expect(generatedPatches).toEqual([null]);
    expect(useKeyStore.getState().canonicalPositions).toEqual(before);
  });

  it('대기 중 삭제된 id는 wire에 싣지 않는다', async () => {
    // 클릭 시점엔 존재, 슬롯 시점 문서에서 삭제된 상황
    slotBase = () => {
      const base = documentFromStores();
      base.keyPositions['4key'] = base.keyPositions['4key'].filter(
        (position) => position.id !== ID_A,
      );
      return base;
    };

    const applied = await applyElementPatchById('key', ID_A, () => ({
      inactiveImage: 'picked.png',
    }));

    expect(applied).toBe(false);
    expect(generatedPatches).toEqual([null]);
  });

  it('updater가 id를 끼워 넣어도 신원은 보존된다', async () => {
    const applied = await applyElementPatchById(
      'key',
      ID_A,
      () => ({ id: 'hijacked', inactiveImage: 'picked.png' } as never),
    );

    expect(applied).toBe(true);
    expect(useKeyStore.getState().canonicalPositions['4key'][0].id).toBe(ID_A);
    expect(generatedPatches[0]?.keyPositions?.['4key'][0].id).toBe(ID_A);
  });

  it('updater가 입력 객체의 id를 직접 변조해도 신원은 보존된다', async () => {
    const applied = await applyElementPatchById('key', ID_A, (current) => {
      (current as { id?: string }).id = 'mutated';
      return { inactiveImage: 'picked.png' };
    });

    expect(applied).toBe(true);
    expect(useKeyStore.getState().canonicalPositions['4key'][0].id).toBe(ID_A);
    expect(generatedPatches[0]?.keyPositions?.['4key'][0].id).toBe(ID_A);
  });

  const GRAPH_SEED: GraphItemPosition = {
    ...createDefaultKeyPosition(),
    id: '44444444-4444-4444-8444-444444444444',
    statType: 'kps',
    graphType: 'line',
    graphSpeed: 1000,
    graphColor: '#86EFAC',
  } as GraphItemPosition;

  it('시작 시점 ID 집합 전체를 한 트랜잭션으로 적용한다', async () => {
    const stat = {
      ...createDefaultKeyPosition(),
      id: ID_S,
      statType: 'kps',
    } as StatItemPosition;
    useStatItemStore.setState({ positions: { '4key': [stat] } });
    useGraphItemStore.setState({ positions: { '4key': [GRAPH_SEED] } });
    const [a, b] = useKeyStore.getState().canonicalPositions['4key'];
    useKeyStore.getState().setPositions({ '4key': [b, a] });

    const applied = await applyElementPatchesById(
      { key: [ID_A, ID_B], stat: [ID_S], graph: [GRAPH_SEED.id!] },
      () => ({ inactiveImage: 'batch.png' }),
    );

    expect(applied).toBe(4);
    expect(api.commitGeneratedPatch).toHaveBeenCalledOnce();
    const patch = generatedPatches[0];
    expect(
      patch?.keyPositions?.['4key'].every(
        (position) => position.inactiveImage === 'batch.png',
      ),
    ).toBe(true);
    expect(patch?.statPositions?.['4key'][0].inactiveImage).toBe('batch.png');
    expect(patch?.graphPositions?.['4key'][0].inactiveImage).toBe('batch.png');
    expect(patch?.knobPositions).toBeUndefined();
    expect(
      patch?.keyPositions?.['4key'].map((position) => position.id).sort(),
    ).toEqual([ID_A, ID_B].sort());
    expect(
      useKeyStore.getState().canonicalPositions['4key'][0].inactiveImage,
    ).toBe('batch.png');
  });

  it('삭제된 id는 건너뛰고 찾은 요소에만 적용한다', async () => {
    const applied = await applyElementPatchesById(
      { key: [ID_A, ID_GONE], stat: [ID_GONE] },
      () => ({ inactiveImage: 'batch.png' }),
    );

    expect(applied).toBe(1);
    const patch = generatedPatches[0];
    expect(patch?.keyPositions?.['4key'][0].inactiveImage).toBe('batch.png');
    expect(patch?.keyPositions?.['4key'][1].inactiveImage ?? '').toBe('');
    expect(patch?.statPositions).toBeUndefined();
  });

  it('아무 요소도 못 찾으면 커밋하지 않는다', async () => {
    const applied = await applyElementPatchesById({ key: [ID_GONE] }, () => ({
      inactiveImage: 'batch.png',
    }));

    expect(applied).toBe(0);
    expect(generatedPatches).toEqual([null]);
  });

  it('updater는 요소당 eager와 wire 생성에서 두 번 실행될 수 있다', async () => {
    // 계약 고정: updater는 동기·순수·멱등이어야 한다
    const updater = vi.fn(() => ({ inactiveImage: 'twice.png' }));

    await applyElementPatchesById({ key: [ID_A] }, updater);

    expect(updater).toHaveBeenCalledTimes(2);
  });

  it('선행 compatibility write가 큐를 점유하면 생성 커밋은 그 뒤에 실행된다', async () => {
    let releaseBlocker!: () => void;
    const blocker = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });
    const blocked = enqueueEditorCompatibilityWrite(
      () => blocker,
      () => undefined,
    );

    const pending = applyElementPatchesById({ key: [ID_A] }, () => ({
      inactiveImage: 'queued.png',
    }));
    await Promise.resolve();
    // 큐를 건너뛰면 여기서 이미 호출된다 - 먼저 캡처하고 대기 중인
    // writer가 나중에 실행되어 이 값을 되돌리는 순서 위반
    expect(api.commitGeneratedPatch).not.toHaveBeenCalled();

    releaseBlocker();
    await blocked;
    expect(await pending).toBe(1);
    expect(api.commitGeneratedPatch).toHaveBeenCalledOnce();
  });

  it('커밋 실패는 내부에서 소비하고 대상 수를 반환한다', async () => {
    api.commitGeneratedPatch.mockImplementation(
      async (generate: (base: EditorDocumentV1) => EditorPatchV1 | null) => {
        generate(documentFromStores());
        throw new Error('commit failed');
      },
    );
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const applied = await applyElementPatchesById({ key: [ID_A] }, () => ({
      inactiveImage: 'failed.png',
    }));

    expect(applied).toBe(1);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('활성 게스처를 정산하지 않는다', async () => {
    editGestureController.preview('4key', [{ index: 0, patch: { dx: 5 } }], {
      domain: 'keyPosition',
    });
    const activeBefore = editGestureController.activeGestureId();
    expect(activeBefore).not.toBeNull();

    const applied = await applyElementPatchById('key', ID_B, () => ({
      inactiveImage: 'picked.png',
    }));

    expect(applied).toBe(true);
    expect(editGestureController.activeGestureId()).toBe(activeBefore);
  });
});
