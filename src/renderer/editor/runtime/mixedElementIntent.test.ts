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

class TestIntentAbort extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'ElementIntentAbort';
  }
}

vi.mock('./elementIntent', () => ({
  reportElementOpSkipped: mocks.reportSkipped,
  isElementIntentAbort: (error: unknown) =>
    error instanceof Error && error.name === 'ElementIntentAbort',
}));

vi.mock('@plugins/rpc/pluginRpcClient', () => ({
  getPluginAuthorityGeneration: () => mocks.authorityGeneration,
}));

import {
  runMixedElementOpsIntent,
  runMixedElementDeleteIntent,
  runMixedGestureElementIntent,
} from './mixedElementIntent';

import type { EditorDocumentV1 } from '@src/types/editor';
import type { MixedIntentGeneration } from '@plugins/runtime/displayElement/gestureTransaction';

type Meta = { onEnrolled?: () => void; preflight?: () => void };

describe('혼합 의도 러너 receipt 소유권', () => {
  beforeEach(() => {
    mocks.commitMixed.mockReset();
    mocks.commitMixedIntent.mockReset();
    mocks.commitSemantic.mockReset();
    mocks.reportSkipped.mockClear();
    mocks.authorityGeneration = 7;
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

    await runMixedElementOpsIntent({
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
      runMixedElementOpsIntent({
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
      runMixedElementOpsIntent({
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

    await runMixedElementOpsIntent({
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
      runMixedElementOpsIntent({
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

describe('runMixedGestureElementIntent receipt 소유권', () => {
  beforeEach(() => {
    mocks.commitMixed.mockReset();
    mocks.commitMixedIntent.mockReset();
    mocks.commitSemantic.mockReset();
    mocks.reportSkipped.mockClear();
    mocks.authorityGeneration = 7;
  });

  const gestureOptions = (
    rollback: () => void,
    generate: () => MixedIntentGeneration,
  ) => ({
    gestureId: 'gesture-1',
    initialPluginIds: ['plugin-a'],
    pluginScope: () => ['plugin-a'],
    receipt: { rollback },
    generate,
    skipContext: 'test settlement',
  });

  it('ops generation은 receipt를 복원하지 않고 커밋한다', async () => {
    const rollback = vi.fn();
    mocks.commitMixedIntent.mockImplementation(
      async (options: { generate: (context: unknown) => unknown }) => {
        expect(
          options.generate({ base: {}, pluginProjection: [] }),
        ).toMatchObject({ kind: 'ops' });
      },
    );

    const result = await runMixedGestureElementIntent(
      gestureOptions(rollback, () => ({ kind: 'ops' as const, ops: [] })),
    );

    expect(result).toEqual({ committed: true, satisfied: true });
    expect(rollback).not.toHaveBeenCalled();
  });

  it('generate가 중단하면 receipt를 복원하고 skip을 관측한다', async () => {
    const rollback = vi.fn();
    const abort = new TestIntentAbort('nothing to settle');
    mocks.commitMixedIntent.mockImplementation(
      async (options: {
        generate: (context: unknown) => unknown;
        onFailureBeforeSettle?: (error: unknown) => void;
      }) => {
        try {
          options.generate({ base: {}, pluginProjection: [] });
        } catch (error) {
          options.onFailureBeforeSettle?.(error);
          throw error;
        }
      },
    );

    const result = await runMixedGestureElementIntent(
      gestureOptions(rollback, () => {
        throw abort;
      }),
    );

    expect(result).toEqual({ committed: false, satisfied: false });
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(mocks.reportSkipped).toHaveBeenCalledWith('test settlement');
  });

  it('편입 전 실패는 receipt를 복원하고 원 오류를 전파한다', async () => {
    const rollback = vi.fn();
    const failure = new Error('setup failed');
    mocks.commitMixedIntent.mockImplementation(
      async (options: { onFailureBeforeSettle?: (e: unknown) => void }) => {
        options.onFailureBeforeSettle?.(failure);
        throw failure;
      },
    );

    await expect(
      runMixedGestureElementIntent(
        gestureOptions(rollback, () => ({ kind: 'ops' as const, ops: [] })),
      ),
    ).rejects.toThrow('setup failed');
    expect(rollback).toHaveBeenCalledTimes(1);
  });

  it('편입 후 실패는 gesture 실패 경로가 소유한다 - 복원 금지', async () => {
    const rollback = vi.fn();
    mocks.commitMixedIntent.mockImplementation(
      async (options: { onEnrolled?: () => void }) => {
        options.onEnrolled?.();
        throw new Error('commit failed');
      },
    );

    await expect(
      runMixedGestureElementIntent(
        gestureOptions(rollback, () => ({ kind: 'ops' as const, ops: [] })),
      ),
    ).rejects.toThrow('commit failed');
    expect(rollback).not.toHaveBeenCalled();
  });

  it('satisfied generation은 커밋 없이 종료한다', async () => {
    const rollback = vi.fn();
    mocks.commitMixedIntent.mockImplementation(
      async (options: { generate: (context: unknown) => unknown }) => {
        options.generate({ base: {}, pluginProjection: [] });
      },
    );

    const result = await runMixedGestureElementIntent(
      gestureOptions(rollback, () => ({ kind: 'satisfied' as const })),
    );

    expect(result).toEqual({ committed: false, satisfied: true });
    expect(rollback).not.toHaveBeenCalled();
  });
});
