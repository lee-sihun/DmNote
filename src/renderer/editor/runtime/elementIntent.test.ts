import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultKeyPosition } from '../model/keys';

const api = vi.hoisted(() => ({
  commitGeneratedPatch: vi.fn(),
}));

vi.mock('./editorStateCoordinator', () => ({
  editorCoordinator: { commitGeneratedPatch: api.commitGeneratedPatch },
}));

import { useKeyStore } from '@stores/data/useKeyStore';
import {
  applyPropertyIntentsEagerly,
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
