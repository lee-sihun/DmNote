import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultKeyPosition } from '../model/keys';

const api = vi.hoisted(() => ({
  commitGeneratedPatch: vi.fn(),
}));

vi.mock('./editorStateCoordinator', () => ({
  editorCoordinator: { commitGeneratedPatch: api.commitGeneratedPatch },
}));

import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import {
  applySealedSliceMutation,
  applyPropertyIntentsEagerly,
  createNativePositionDragReceipt,
  intentPatch,
  runElementIntent,
} from './elementIntent';

import type { EditorDocumentV1, EditorPatchV1 } from '@src/types/editor';
import type { NativeElementType } from '../model/elementIdMap';

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';

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
    useStatItemStore.setState({
      positions: {
        '4key': [{ id: ID_B, dx: 0, dy: 0, width: 10, height: 10, zIndex: 2 }],
      } as never,
    });
  });

  it.each([false, true])(
    '드래그 receipt는 새 canonical 위치를 보존한다 (이후 이동=%s)',
    (moveAgain) => {
      const receipt = createNativePositionDragReceipt([
        { type: 'key', id: ID_A },
      ]);
      const move = (dx: number) => {
        const state = useKeyStore.getState();
        state.setPositions({
          '4key': [{ ...state.canonicalPositions['4key'][0], dx }],
        });
      };
      receipt.apply(() => move(20));
      const current = useKeyStore.getState().canonicalPositions['4key'][0];
      useKeyStore
        .getState()
        .setPositions({ '4key': [{ ...current, dx: 100, width: 321 }] });
      if (moveAgain) receipt.apply(() => move(120));
      receipt.rollback();
      expect(
        useKeyStore.getState().canonicalPositions['4key'][0],
      ).toMatchObject({ dx: 100, dy: 0, width: 321 });
    },
  );

  it('드래그 receipt는 삭제된 대상을 되살리지 않는다', () => {
    const receipt = createNativePositionDragReceipt([
      { type: 'key', id: ID_A },
    ]);
    receipt.apply(() => {
      const current = useKeyStore.getState().canonicalPositions['4key'][0];
      useKeyStore.getState().setPositions({ '4key': [{ ...current, dx: 20 }] });
    });
    useKeyStore.getState().setPositions({ '4key': [] });
    receipt.rollback();
    expect(useKeyStore.getState().canonicalPositions['4key']).toEqual([]);
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

  it('여러 타입 eager 중 뒤 setter가 실패하면 앞선 타입도 원자 복원한다', () => {
    const statStore = useStatItemStore.getState();
    const original = statStore.setPositions;
    vi.spyOn(statStore, 'setPositions').mockImplementationOnce((next) => {
      const keyState = useKeyStore.getState();
      keyState.setPositions({
        '4key': [
          {
            ...keyState.canonicalPositions['4key'][0],
            noteWidth: 777,
          },
        ],
      } as never);
      useStatItemStore.setState({ positions: next });
      throw new Error('stat listener failed');
    });

    expect(() =>
      applyPropertyIntentsEagerly(
        new Map([
          ['key', new Map([[ID_A, { zIndex: 9 }]])],
          ['stat', new Map([[ID_B, { zIndex: 8 }]])],
        ]) as never,
      ),
    ).toThrow('stat listener failed');
    expect(
      useKeyStore.getState().canonicalPositions['4key'][0].zIndex,
    ).toBeUndefined();
    expect(useKeyStore.getState().canonicalPositions['4key'][0].noteWidth).toBe(
      777,
    );
    expect(useStatItemStore.getState().positions['4key'][0].zIndex).toBe(2);
    useStatItemStore.setState({ setPositions: original });
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

  it('봉인하지 않은 mode 변경은 대상 mode 복원을 막지 않는다', () => {
    const document = baselineDocument();
    document.keys['7key'] = ['KeyZ'];
    document.keyPositions['7key'] = [
      {
        ...document.keyPositions['4key'][0],
        id: '77777777-7777-4777-8777-777777777777',
      },
    ];
    syncStoreToBaselineDocument(document);
    const receipt = applySealedSliceMutation({
      modes: ['4key'],
      fields: ['keys', 'keyPositions'],
      mutate: () => {
        const state = useKeyStore.getState();
        state.setKeyMappingsAndPositions(
          { ...state.keyMappings, '4key': ['KeyB'] },
          {
            ...state.canonicalPositions,
            '4key': [state.canonicalPositions['4key'][1]],
          },
        );
      },
    });

    const state = useKeyStore.getState();
    state.setKeyMappingsAndPositions(
      { ...state.keyMappings, '7key': ['KeyY'] },
      {
        ...state.canonicalPositions,
        '7key': [{ ...state.canonicalPositions['7key'][0], width: 321 }],
      },
    );
    receipt.rollback();

    expect(useKeyStore.getState().keyMappings['4key']).toEqual([
      'KeyA',
      'KeyB',
    ]);
    expect(useKeyStore.getState().canonicalPositions['4key']).toHaveLength(2);
    expect(useKeyStore.getState().keyMappings['7key']).toEqual(['KeyY']);
    expect(useKeyStore.getState().canonicalPositions['7key'][0].width).toBe(
      321,
    );
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
