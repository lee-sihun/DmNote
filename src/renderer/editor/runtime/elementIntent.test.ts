import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultKeyPosition } from '../model/keys';

const api = vi.hoisted(() => ({
  commitGeneratedPatch: vi.fn(),
}));

vi.mock('./editorStateCoordinator', () => ({
  editorCoordinator: { commitGeneratedPatch: api.commitGeneratedPatch },
}));

import { useKeyStore } from '@stores/data/useKeyStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import {
  applyGestureIntentsEagerly,
  applySealedSliceMutation,
  applyIndexIntentsEagerly,
  applyPropertyIntentsEagerly,
  captureIndexIntentBaseline,
  generateIndexIntentPatch,
  intentPatch,
  runElementIntent,
} from './elementIntent';

import type { EditorDocumentV1, EditorPatchV1 } from '@src/types/editor';
import type { NativeElementType } from '../model/elementIdMap';

const ID_A = '11111111-1111-4111-8111-111111111111';

const keyAt = (id: string) => ({ ...createDefaultKeyPosition(), id });

const intentsFor = (
  patch: Record<string, unknown>,
): Map<NativeElementType, Map<string, Record<string, unknown>>> =>
  new Map([['key' as NativeElementType, new Map([[ID_A, patch]])]]);

describe('elementIntent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useKeyStore.setState({
      selectedKeyType: '4key',
      canonicalPositions: { '4key': [keyAt(ID_A)] },
      positions: { '4key': [keyAt(ID_A)] },
    });
  });

  it('속성 receipt는 필드 단위로 복원한다', () => {
    const receipt = applyPropertyIntentsEagerly(
      intentsFor({ inactiveImage: 'eager.png' }),
    );
    expect(
      useKeyStore.getState().canonicalPositions['4key'][0].inactiveImage,
    ).toBe('eager.png');

    receipt!.rollback();

    expect(
      useKeyStore.getState().canonicalPositions['4key'][0].inactiveImage ?? '',
    ).toBe('');
  });

  it('CAS: 이후 다른 writer가 같은 필드를 바꿨으면 복원하지 않는다', () => {
    const receipt = applyPropertyIntentsEagerly(
      intentsFor({ inactiveImage: 'eager.png' }),
    );
    // 다른 writer가 같은 필드를 다른 값으로
    const state = useKeyStore.getState();
    state.setPositions({
      '4key': [
        { ...state.canonicalPositions['4key'][0], inactiveImage: 'newer.png' },
      ],
    } as never);

    receipt!.rollback();

    // 소유권 밖 - 그대로 유지
    expect(
      useKeyStore.getState().canonicalPositions['4key'][0].inactiveImage,
    ).toBe('newer.png');
  });

  it('CAS: 다른 필드만 바뀌었으면 소유 필드는 복원한다', () => {
    const receipt = applyPropertyIntentsEagerly(
      intentsFor({ inactiveImage: 'eager.png' }),
    );
    const state = useKeyStore.getState();
    state.setPositions({
      '4key': [
        {
          ...state.canonicalPositions['4key'][0],
          noteWidth: 222,
        },
      ],
    } as never);

    receipt!.rollback();

    const position = useKeyStore.getState().canonicalPositions['4key'][0];
    expect(position.inactiveImage ?? '').toBe('');
    expect(position.noteWidth).toBe(222);
  });

  it('편입 후 실패는 receipt를 호출하지 않는다', async () => {
    const rollback = vi.fn();
    api.commitGeneratedPatch.mockImplementation(
      async (
        generate: (base: EditorDocumentV1) => EditorPatchV1 | null,
        meta?: { onEnrolled?: () => void },
      ) => {
        generate({} as EditorDocumentV1);
        meta?.onEnrolled?.();
        throw new Error('after enrollment');
      },
    );

    await expect(
      runElementIntent({
        applyEager: () => ({ rollback }),
        generate: () => intentPatch({ schemaVersion: 1 }),
      }),
    ).rejects.toThrow('after enrollment');

    expect(rollback).not.toHaveBeenCalled();
  });

  it('편입 전 실패는 receipt를 호출하고 원 오류를 전파한다', async () => {
    const rollback = vi.fn();
    api.commitGeneratedPatch.mockRejectedValue(new Error('start failed'));

    await expect(
      runElementIntent({
        applyEager: () => ({ rollback }),
        generate: () => intentPatch({ schemaVersion: 1 }),
      }),
    ).rejects.toThrow('start failed');

    expect(rollback).toHaveBeenCalledTimes(1);
  });

  it('satisfied(이미 canonical 달성)는 롤백하지 않는다', async () => {
    const rollback = vi.fn();
    api.commitGeneratedPatch.mockImplementation(
      async (generate: (base: EditorDocumentV1) => EditorPatchV1 | null) => {
        generate({} as EditorDocumentV1);
        return {} as EditorDocumentV1;
      },
    );

    const result = await runElementIntent({
      applyEager: () => ({ rollback }),
      generate: () => ({ kind: 'satisfied' }),
    });

    expect(result.committed).toBe(false);
    expect(result.satisfied).toBe(true);
    expect(rollback).not.toHaveBeenCalled();
  });

  const baselineDocument = (overrides?: {
    keys?: Record<string, unknown[]>;
    layerGroups?: Record<string, unknown[]>;
    positions?: Array<Record<string, unknown>>;
  }) => ({
    schemaVersion: 1,
    keys: overrides?.keys ?? { '4key': ['KeyA', 'KeyB'] },
    keyPositions: {
      '4key': overrides?.positions ?? [
        { ...createDefaultKeyPosition(), width: 40 },
        { ...createDefaultKeyPosition(), width: 80 },
      ],
    },
    statPositions: {},
    graphPositions: {},
    knobPositions: {},
    layerGroups: overrides?.layerGroups ?? {},
  });

  const syncStoreToBaselineDocument = (
    document: ReturnType<typeof baselineDocument>,
  ) => {
    useKeyStore.setState({
      selectedKeyType: '4key',
      keyMappings: document.keys as never,
      canonicalPositions: structuredClone(document.keyPositions) as never,
      positions: structuredClone(document.keyPositions) as never,
    });
    useLayerGroupStore.setState({
      layerGroups: structuredClone(document.layerGroups) as never,
    });
  };

  it('index eager는 keys pair만 변경돼도 fail-closed로 무적용한다', () => {
    const document = baselineDocument();
    const baseline = captureIndexIntentBaseline(document, '4key', [
      'keyPositions',
      'keys',
    ]);
    syncStoreToBaselineDocument(document);
    // 대기 중 rebind가 keys[mode]만 교체
    useKeyStore.setState({
      keyMappings: { '4key': ['KeyC', 'KeyB'] } as never,
    });

    const eager = applyIndexIntentsEagerly(
      baseline,
      new Map([['key', new Map([[0, { width: 120 }]])]]),
    );

    expect(eager.matched).toBe(false);
    expect(eager.receipt).toBeNull();
    expect(useKeyStore.getState().canonicalPositions['4key'][0].width).toBe(40);
  });

  it('index wire는 layerGroups만 변경돼도 null이다', () => {
    const document = baselineDocument();
    const baseline = captureIndexIntentBaseline(document, '4key', [
      'keyPositions',
      'layerGroups',
    ]);
    const movedBase = {
      ...structuredClone(document),
      layerGroups: { '4key': [{ id: 'g1', name: 'g1' }] },
    };

    const patch = generateIndexIntentPatch(
      movedBase as never,
      baseline,
      new Map([['key', new Map([[0, { width: 120 }]])]]),
    );

    expect(patch).toBeNull();
  });

  it('index receipt는 재정렬 후 값이 충돌해도 다른 요소를 오염시키지 않는다', () => {
    const document = baselineDocument();
    const baseline = captureIndexIntentBaseline(document, '4key', [
      'keyPositions',
      'keys',
    ]);
    syncStoreToBaselineDocument(document);

    // index 0을 80으로 eager - 이제 index 1(원래 80)과 값이 같다
    const eager = applyIndexIntentsEagerly(
      baseline,
      new Map([['key', new Map([[0, { width: 80 }]])]]),
    );
    expect(eager.matched).toBe(true);

    // 격리 커밋이 두 요소를 재정렬 (index 0 자리에 다른 요소, width 80)
    const current = useKeyStore.getState().canonicalPositions['4key'];
    useKeyStore.setState({
      canonicalPositions: { '4key': [current[1], current[0]] } as never,
    });

    eager.receipt!.rollback();

    // 신원 증명 실패 - 어느 요소도 40으로 되돌리지 않는다
    const after = useKeyStore.getState().canonicalPositions['4key'];
    expect(after[0].width).toBe(80);
    expect(after[1].width).toBe(80);
  });

  it('index receipt는 무간섭이면 baseline 값으로 복원한다', () => {
    const document = baselineDocument();
    const baseline = captureIndexIntentBaseline(document, '4key', [
      'keyPositions',
      'keys',
    ]);
    syncStoreToBaselineDocument(document);

    const eager = applyIndexIntentsEagerly(
      baseline,
      new Map([['key', new Map([[0, { width: 120 }]])]]),
    );
    expect(eager.matched).toBe(true);
    expect(useKeyStore.getState().canonicalPositions['4key'][0].width).toBe(
      120,
    );

    eager.receipt!.rollback();

    expect(useKeyStore.getState().canonicalPositions['4key'][0].width).toBe(40);
    expect(useKeyStore.getState().canonicalPositions['4key'][1].width).toBe(80);
  });

  it('결합 eager 복원은 stable과 합성을 함께 되돌린다', () => {
    const stablePosition = {
      ...createDefaultKeyPosition(),
      id: ID_A,
      width: 40,
    };
    const syntheticPosition = { ...createDefaultKeyPosition(), width: 80 };
    const document = baselineDocument({
      positions: [stablePosition, syntheticPosition],
    });
    const baseline = captureIndexIntentBaseline(document, '4key', [
      'keyPositions',
      'keys',
    ]);
    syncStoreToBaselineDocument(document);

    const eager = applyGestureIntentsEagerly({
      baseline,
      indexIntents: new Map([['key', new Map([[1, { width: 200 }]])]]),
      propertyIntents: new Map([['key', new Map([[ID_A, { width: 150 }]])]]),
    });
    expect(eager.matched).toBe(true);
    const applied = useKeyStore.getState().canonicalPositions['4key'];
    expect(applied[0].width).toBe(150);
    expect(applied[1].width).toBe(200);

    // targetLost·편입 전 실패의 복원 - stable 변경이 봉인 이전이므로
    // 합성 신원 검사가 자기 자신을 외부 개입으로 오판하지 않아야 한다
    eager.receipt!.rollback();

    const after = useKeyStore.getState().canonicalPositions['4key'];
    expect(after[0].width).toBe(40);
    expect(after[1].width).toBe(80);
  });

  it('index wire는 keys pair만 변경돼도 null이다', () => {
    const document = baselineDocument();
    const baseline = captureIndexIntentBaseline(document, '4key', [
      'keyPositions',
      'keys',
    ]);
    const reboundBase = {
      ...structuredClone(document),
      keys: { '4key': ['KeyC', 'KeyB'] },
    };

    const patch = generateIndexIntentPatch(
      reboundBase as never,
      baseline,
      new Map([['key', new Map([[0, { width: 120 }]])]]),
    );

    expect(patch).toBeNull();
  });

  it('봉인 mutate가 도중에 throw하면 부분 변경을 즉시 복원한다', () => {
    const document = baselineDocument();
    syncStoreToBaselineDocument(document);

    expect(() =>
      applySealedSliceMutation({
        modes: ['4key'],
        fields: ['keys', 'keyPositions'],
        mutate: () => {
          const state = useKeyStore.getState();
          state.setPositions({
            '4key': [{ ...state.canonicalPositions['4key'][0], width: 999 }],
          } as never);
          throw new Error('mid-mutation failure');
        },
      }),
    ).toThrow('mid-mutation failure');

    // 부분 적용이 남지 않는다
    const positions = useKeyStore.getState().canonicalPositions['4key'];
    expect(positions).toHaveLength(2);
    expect(positions[0].width).toBe(40);
  });

  it('대상 소실(null)은 receipt 호출 후 committed false', async () => {
    const rollback = vi.fn();
    api.commitGeneratedPatch.mockImplementation(
      async (generate: (base: EditorDocumentV1) => EditorPatchV1 | null) => {
        generate({} as EditorDocumentV1);
        return {} as EditorDocumentV1;
      },
    );

    const result = await runElementIntent({
      applyEager: () => ({ rollback }),
      generate: () => intentPatch(null),
    });

    expect(result.committed).toBe(false);
    expect(rollback).toHaveBeenCalledTimes(1);
  });
});
