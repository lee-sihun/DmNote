import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  commitMixed: vi.fn(),
  commitMixedIntent: vi.fn(),
  commitSemantic: vi.fn(),
  reportSkipped: vi.fn(),
  authorityGeneration: 7,
}));

vi.mock('@plugins/runtime/displayElement/gestureTransaction', () => ({
  commitMixedGestureTransaction: mocks.commitMixed,
  commitMixedGestureIntent: mocks.commitMixedIntent,
}));

vi.mock('./editorSemanticOps', () => ({
  commitSemanticOps: mocks.commitSemantic,
}));

vi.mock('./elementIntent', () => ({
  reportElementOpSkipped: mocks.reportSkipped,
}));

vi.mock('@plugins/rpc/pluginRpcClient', () => ({
  getPluginAuthorityGeneration: () => mocks.authorityGeneration,
}));

import {
  runMixedElementBoundsIntent,
  runMixedElementDeleteIntent,
  runMixedElementIntent,
} from './mixedElementIntent';

import type { EditorDocumentV1, EditorPatchV1 } from '@src/types/editor';

type Generate = (base: EditorDocumentV1) => EditorPatchV1 | null;
type Meta = { onEnrolled?: () => void; preflight?: () => void };

const baseOptions = (rollback: () => void, generate: Generate) => ({
  gestureId: 'gesture-1',
  pluginIds: ['plugin-a'],
  applyEager: () => ({ rollback }),
  generate,
  skipContext: 'test settlement',
});

describe('runMixedElementIntent receipt 소유권', () => {
  beforeEach(() => {
    mocks.commitMixed.mockReset();
    mocks.commitMixedIntent.mockReset();
    mocks.commitSemantic.mockReset();
    mocks.reportSkipped.mockClear();
    mocks.authorityGeneration = 7;
  });

  it('generatedNull은 성공해도 receipt를 복원하고 skip을 관측한다', async () => {
    const rollback = vi.fn();
    mocks.commitMixed.mockImplementation(
      async (
        _gestureId: string,
        generate: Generate,
        _ids: unknown,
        meta: Meta,
      ) => {
        generate({} as EditorDocumentV1);
        meta.onEnrolled?.();
      },
    );

    await runMixedElementIntent(baseOptions(rollback, () => null));

    expect(rollback).toHaveBeenCalledTimes(1);
    expect(mocks.reportSkipped).toHaveBeenCalledWith('test settlement');
  });

  it('expectNull은 복원하되 skip 관측을 생략한다', async () => {
    const rollback = vi.fn();
    mocks.commitMixed.mockImplementation(
      async (
        _gestureId: string,
        generate: Generate,
        _ids: unknown,
        meta: Meta,
      ) => {
        generate({} as EditorDocumentV1);
        meta.onEnrolled?.();
      },
    );

    await runMixedElementIntent({
      ...baseOptions(rollback, () => null),
      expectNull: true,
    });

    expect(rollback).toHaveBeenCalledTimes(1);
    expect(mocks.reportSkipped).not.toHaveBeenCalled();
  });

  it('편입 전 실패는 receipt를 복원하고 원 오류를 전파한다', async () => {
    const rollback = vi.fn();
    mocks.commitMixed.mockRejectedValue(new Error('drain failed'));

    await expect(
      runMixedElementIntent(
        baseOptions(rollback, () => ({ schemaVersion: 1 })),
      ),
    ).rejects.toThrow('drain failed');

    expect(rollback).toHaveBeenCalledTimes(1);
  });

  it('편입 후 실패는 gesture 실패 경로가 소유한다 - 복원 금지', async () => {
    const rollback = vi.fn();
    mocks.commitMixed.mockImplementation(
      async (
        _gestureId: string,
        generate: Generate,
        _ids: unknown,
        meta: Meta,
      ) => {
        generate({} as EditorDocumentV1);
        meta.onEnrolled?.();
        throw new Error('transaction failed');
      },
    );

    await expect(
      runMixedElementIntent(
        baseOptions(rollback, () => ({ schemaVersion: 1 })),
      ),
    ).rejects.toThrow('transaction failed');

    expect(rollback).not.toHaveBeenCalled();
  });

  it('generatedNull 후 plugin 실패도 receipt를 복원한다 - null 판정 우선', async () => {
    const rollback = vi.fn();
    mocks.commitMixed.mockImplementation(
      async (
        _gestureId: string,
        generate: Generate,
        _ids: unknown,
        meta: Meta,
      ) => {
        generate({} as EditorDocumentV1);
        meta.onEnrolled?.();
        throw new Error('plugin commit failed');
      },
    );

    await expect(
      runMixedElementIntent(baseOptions(rollback, () => null)),
    ).rejects.toThrow('plugin commit failed');

    expect(rollback).toHaveBeenCalledTimes(1);
  });

  it('안정 bounds 혼합 의도는 ordered ops를 같은 transaction에 전달한다', async () => {
    const rollback = vi.fn();
    mocks.commitMixed.mockImplementation(
      async (_gestureId, mutation, _ids, meta: Meta) => {
        expect(mutation).toEqual({
          opsVersion: 1,
          ops: [
            {
              kind: 'setBounds',
              elementType: 'key',
              id: 'id-a',
              bounds: { dx: 1, dy: 2, width: 3, height: 4 },
            },
          ],
        });
        meta.onEnrolled?.();
      },
    );

    await runMixedElementBoundsIntent({
      gestureId: 'gesture-1',
      pluginIds: ['plugin-a'],
      ops: [
        {
          kind: 'setBounds',
          elementType: 'key',
          id: 'id-a',
          bounds: { dx: 1, dy: 2, width: 3, height: 4 },
        },
      ],
      receipt: { rollback },
    });

    expect(rollback).not.toHaveBeenCalled();
  });

  it('안정 bounds 혼합 의도의 편입 전 실패만 receipt를 복원한다', async () => {
    const rollback = vi.fn();
    mocks.commitMixed.mockRejectedValueOnce(new Error('setup failed'));

    await expect(
      runMixedElementBoundsIntent({
        gestureId: 'gesture-1',
        pluginIds: ['plugin-a'],
        ops: [],
        receipt: { rollback },
      }),
    ).rejects.toThrow('setup failed');

    expect(rollback).toHaveBeenCalledOnce();
  });

  it('안정 bounds 혼합 의도의 편입 후 실패는 receipt를 복원하지 않는다', async () => {
    const rollback = vi.fn();
    mocks.commitMixed.mockImplementationOnce(
      async (_mutation, _ids, _scope, meta) => {
        meta.onEnrolled?.();
        throw new Error('backend failed');
      },
    );

    await expect(
      runMixedElementBoundsIntent({
        gestureId: 'gesture-1',
        pluginIds: ['plugin-a'],
        ops: [],
        receipt: { rollback },
      }),
    ).rejects.toThrow('backend failed');

    expect(rollback).not.toHaveBeenCalled();
  });

  it('plugin scope가 비면 안정 bounds를 editor-only semantic commit으로 보낸다', async () => {
    const rollback = vi.fn();
    mocks.commitSemantic.mockImplementation(async (_ops, meta) => {
      meta.onEnrolled?.();
      return { document: {}, opResults: [{ status: 'targetMissing' }] };
    });
    const ops = [
      {
        kind: 'setBounds' as const,
        elementType: 'key' as const,
        id: 'id-a',
        bounds: { dx: 1, dy: 2, width: 3, height: 4 },
      },
    ];

    await runMixedElementBoundsIntent({
      gestureId: 'gesture-editor-only',
      pluginIds: [],
      ops,
      receipt: { rollback },
    });

    expect(mocks.commitSemantic).toHaveBeenCalledWith(
      ops,
      expect.objectContaining({
        gestureId: 'gesture-editor-only',
        onEnrolled: expect.any(Function),
      }),
    );
    expect(mocks.commitMixed).not.toHaveBeenCalled();
    expect(rollback).not.toHaveBeenCalled();
  });

  it('plugin scope가 빈 editor-only 편입 전 실패도 receipt를 복원한다', async () => {
    const rollback = vi.fn();
    mocks.commitSemantic.mockRejectedValueOnce(new Error('setup failed'));

    await expect(
      runMixedElementBoundsIntent({
        gestureId: 'gesture-editor-only',
        pluginIds: [],
        ops: [],
        receipt: { rollback },
      }),
    ).rejects.toThrow('setup failed');

    expect(mocks.commitMixed).not.toHaveBeenCalled();
    expect(rollback).toHaveBeenCalledOnce();
  });

  it('삭제 의도는 재주입 대상을 거르고 봉인 뒤 신규 요소를 보존한다', async () => {
    const rollback = vi.fn();
    const ops = [
      {
        kind: 'deleteElement' as const,
        elementType: 'key' as const,
        id: 'native-id',
      },
    ];
    mocks.commitMixedIntent.mockImplementationOnce(async (options) => {
      const generation = options.generate({
        base: {} as EditorDocumentV1,
        pluginProjection: [
          { fullId: 'plugin-a:gone', definitionId: 'plugin-a' },
          { fullId: 'plugin-a:new', definitionId: 'plugin-a' },
        ],
      });
      expect(generation).toEqual({
        kind: 'ops',
        ops,
        desiredPluginProjection: [
          { fullId: 'plugin-a:new', definitionId: 'plugin-a' },
        ],
      });
      options.onEnrolled?.();
    });

    await runMixedElementDeleteIntent({
      gestureId: 'gesture-delete',
      pluginIds: ['plugin-a'],
      deletedPluginFullIds: ['plugin-a:gone'],
      ops,
      receipt: { rollback },
    });

    expect(mocks.commitMixedIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        gestureId: 'gesture-delete',
        initialPluginIds: ['plugin-a'],
        pluginScope: expect.any(Function),
      }),
    );
    expect(rollback).not.toHaveBeenCalled();
  });

  it('plugin scope가 빈 삭제는 semantic 재시도 경로로 보낸다', async () => {
    const rollback = vi.fn();
    const ops = [
      {
        kind: 'deleteElement' as const,
        elementType: 'key' as const,
        id: 'native-id',
      },
    ];
    mocks.commitSemantic.mockImplementationOnce(async (_ops, meta) => {
      meta.onEnrolled?.();
      return { document: {}, opResults: [{ status: 'applied' }] };
    });

    await runMixedElementDeleteIntent({
      gestureId: 'gesture-native-delete',
      pluginIds: [],
      deletedPluginFullIds: [],
      ops,
      receipt: { rollback },
    });

    expect(mocks.commitSemantic).toHaveBeenCalledWith(
      ops,
      expect.objectContaining({
        gestureId: 'gesture-native-delete',
        onEnrolled: expect.any(Function),
      }),
    );
    expect(mocks.commitMixedIntent).not.toHaveBeenCalled();
    expect(rollback).not.toHaveBeenCalled();
  });

  it('panel 삭제 generation은 mixed commit까지 그대로 전달된다', async () => {
    mocks.commitMixedIntent.mockImplementationOnce(async (options) => {
      expect(options.expectedAuthorityGeneration).toBe(7);
      options.onEnrolled?.();
    });

    await runMixedElementDeleteIntent({
      gestureId: 'gesture-panel-delete',
      pluginIds: ['plugin-a'],
      deletedPluginFullIds: ['plugin-a:gone'],
      ops: [],
      receipt: null,
      expectedAuthorityGeneration: 7,
    });
  });

  it('editor-only 삭제 완료 중 generation이 바뀌면 성공으로 마치지 않는다', async () => {
    const rollback = vi.fn();
    mocks.commitSemantic.mockImplementationOnce(async (_ops, meta) => {
      meta.onEnrolled?.();
      mocks.authorityGeneration = 8;
      return { document: {}, opResults: [{ status: 'applied' }] };
    });

    await expect(
      runMixedElementDeleteIntent({
        gestureId: 'gesture-panel-delete',
        pluginIds: [],
        deletedPluginFullIds: [],
        ops: [],
        receipt: { rollback },
        expectedAuthorityGeneration: 7,
      }),
    ).rejects.toThrow('plugin authority generation changed');
    expect(rollback).not.toHaveBeenCalled();
  });

  it('editor-only 삭제는 직렬 슬롯 진입 전 바뀐 generation에서 중단한다', async () => {
    const rollback = vi.fn();
    mocks.commitSemantic.mockImplementationOnce(async (_ops, meta) => {
      mocks.authorityGeneration = 8;
      meta.preflight?.();
      meta.onEnrolled?.();
      return { document: {}, opResults: [{ status: 'applied' }] };
    });

    await expect(
      runMixedElementDeleteIntent({
        gestureId: 'gesture-panel-delete',
        pluginIds: [],
        deletedPluginFullIds: [],
        ops: [],
        receipt: { rollback },
        expectedAuthorityGeneration: 7,
      }),
    ).rejects.toThrow('plugin authority generation changed');
    expect(rollback).toHaveBeenCalledOnce();
  });
});
