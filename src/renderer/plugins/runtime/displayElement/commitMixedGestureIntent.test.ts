import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EDITOR_OPS_VERSION } from '@src/types/editor';

const mocks = vi.hoisted(() => ({
  drainQueues: vi.fn(() => Promise.resolve()),
  stageGesture: vi.fn(),
  unstageGesture: vi.fn(),
  gestureCommit: vi.fn(() =>
    Promise.resolve({
      editorRevision: 1,
      changedFields: [],
      changedPluginIds: [],
      pluginModelRevision: 1,
      authorityGeneration: 1,
    } as {
      editorRevision: number;
      changedFields: string[];
      editorOpResults?: unknown[];
      changedPluginIds: string[];
      pluginModelRevision: number;
      authorityGeneration?: number;
    }),
  ),
  editorCommit: vi.fn(() =>
    Promise.resolve({
      revision: 1,
      changedFields: [],
    }),
  ),
  buildSaved: vi.fn(
    (elements: Array<{ fullId: string; zIndex?: number }>, pluginId: string) =>
      elements.map(
        (element) => `${pluginId}:${element.fullId}:${element.zIndex}`,
      ),
  ),
  applyCanonical: vi.fn(() => Promise.resolve()),
  setElements: vi.fn(),
  rotateSession: vi.fn(),
  elements: [] as Array<Record<string, unknown>>,
}));

vi.mock('@api/modules/gestureApi', () => ({
  gestureApi: { commit: mocks.gestureCommit },
}));

vi.mock('@api/modules/editorApi', () => ({
  editorApi: { commit: mocks.editorCommit },
}));

vi.mock(
  '@src/renderer/editor/runtime/coordinator/editorStateCoordinator',
  () => ({
    editorCoordinator: {
      // 실제 순서 재현: prepare → generator 평가 → onEnrolled → transaction callback
      commitGesture: vi.fn(
        async (
          changes: unknown,
          _gestureId: string,
          commit: (context: {
            editorBaseRevision: number;
            mutationId: string;
            editorChanges?: unknown;
            editorOpsVersion?: typeof EDITOR_OPS_VERSION;
            editorOps?: unknown[];
          }) => Promise<unknown>,
          meta?: { onEnrolled?: () => void; prepare?: () => Promise<void> },
        ) => {
          await meta?.prepare?.();
          const mutation =
            typeof changes === 'function'
              ? (changes as (base: unknown) => unknown)({ schemaVersion: 1 })
              : changes;
          const isOps =
            typeof mutation === 'object' &&
            mutation !== null &&
            'opsVersion' in mutation;
          meta?.onEnrolled?.();
          await commit({
            editorBaseRevision: 0,
            mutationId: 'mutation-1',
            ...(isOps
              ? {
                  editorOpsVersion: EDITOR_OPS_VERSION,
                  editorOps: (mutation as unknown as { ops: unknown[] }).ops,
                }
              : mutation
              ? {
                  editorChanges: {
                    ...(mutation as Record<string, unknown>),
                    schemaVersion: 2,
                  },
                }
              : {}),
          });
          return {};
        },
      ),
    },
  }),
);

vi.mock('@src/renderer/editor/runtime/lifecycle/editorWriteBarrier', () => ({
  trackEditorWrite: <T>(promise: T) => promise,
}));

vi.mock('@stores/plugin/usePluginDisplayElementStore', () => ({
  usePluginDisplayElementStore: {
    getState: () => ({
      elements: mocks.elements,
      definitions: new Map(),
      setElements: mocks.setElements,
    }),
  },
}));

vi.mock('@stores/data/useHistoryStatusStore', () => ({
  useHistoryStatusStore: { getState: () => ({ historyEpoch: 0 }) },
}));

vi.mock('@plugins/runtime/pluginAuthorityGeneration', () => ({
  getPluginAuthorityGeneration: () => 0,
}));

vi.mock('@plugins/runtime/pluginModelRevision', () => ({
  getBackendPluginRevision: () => 0,
  noteBackendPluginRevision: vi.fn(),
}));

vi.mock('./instancesUndoSync', () => ({
  applyCanonicalPluginInstances: mocks.applyCanonical,
  notePluginInstancesMutation: vi.fn(),
}));

vi.mock('../api/defineElement', () => ({
  buildSavedPluginInstances: mocks.buildSaved,
}));

vi.mock('./instancesCommitQueue', () => ({
  drainPluginInstancesCommitQueues: mocks.drainQueues,
  getStagedPluginInstancesGestureId: () => null,
  hasConflictingPluginInstancesGesture: () => false,
  rotatePluginInstancesEditSession: mocks.rotateSession,
  stagePluginInstancesGesture: mocks.stageGesture,
  unstagePluginInstancesGesture: mocks.unstageGesture,
}));

vi.mock('@utils/plugin/panelModelSync', () => ({
  schedulePluginPanelModelSync: vi.fn(),
}));

import { isElementIntentAbort } from '@src/renderer/editor/runtime/intent/elementIntent';

import { commitMixedGestureIntent } from './gestureTransaction';

describe('commitMixedGestureIntent', () => {
  beforeEach(() => {
    mocks.drainQueues.mockClear();
    mocks.stageGesture.mockClear();
    mocks.unstageGesture.mockClear();
    mocks.gestureCommit.mockClear();
    mocks.editorCommit.mockClear();
    mocks.buildSaved.mockClear();
    mocks.applyCanonical.mockClear();
    mocks.setElements.mockClear();
    mocks.rotateSession.mockClear();
    mocks.drainQueues.mockReset();
    mocks.drainQueues.mockImplementation(() => Promise.resolve());
    mocks.elements = [];
  });

  it('plugin scope가 비어 있으면 일반 editor 커밋으로 저장한다', async () => {
    await commitMixedGestureIntent({
      gestureId: 'gesture-native-only',
      initialPluginIds: [],
      pluginScope: () => [],
      generate: () => ({
        kind: 'patch',
        patch: { schemaVersion: 1, statPositions: {} },
      }),
    });

    expect(mocks.editorCommit).toHaveBeenCalledWith({
      baseRevision: 0,
      mutationId: 'mutation-1',
      changes: { schemaVersion: 2, statPositions: {} },
      gestureId: 'gesture-native-only',
    });
    expect(mocks.gestureCommit).not.toHaveBeenCalled();
    expect(mocks.buildSaved).not.toHaveBeenCalled();
  });

  it('prepare 고정점이 상한까지 수렴하지 않으면 전체 중단한다', async () => {
    let round = 0;
    const onFailure = vi.fn();
    await expect(
      commitMixedGestureIntent({
        gestureId: 'gesture-cap',
        initialPluginIds: ['plugin-0'],
        // 매 라운드 새 definition 출현 - 고정점 미성립
        pluginScope: () => {
          round += 1;
          return [`plugin-${round}`];
        },
        generate: () => ({ kind: 'patch', patch: { schemaVersion: 1 } }),
        onFailureBeforeSettle: onFailure,
      }),
    ).rejects.toSatisfy((error: unknown) => isElementIntentAbort(error));

    // 복원 훅이 staged 해제보다 먼저
    expect(onFailure).toHaveBeenCalledTimes(1);
    const failureOrder = onFailure.mock.invocationCallOrder[0];
    const unstageOrder = mocks.unstageGesture.mock.invocationCallOrder[0];
    expect(failureOrder).toBeLessThan(unstageOrder);
    // editor 커밋 미도달
    expect(mocks.gestureCommit).not.toHaveBeenCalled();
  });

  it('transaction은 raw 봉인본이 아니라 generator의 desired projection을 저장한다', async () => {
    mocks.elements = [
      { fullId: 'plugin-a:one', definitionId: 'plugin-a', zIndex: 0 },
    ];
    await commitMixedGestureIntent({
      gestureId: 'gesture-desired',
      initialPluginIds: ['plugin-a'],
      pluginScope: () => ['plugin-a'],
      generate: ({ pluginProjection }) => ({
        kind: 'patch',
        patch: { schemaVersion: 1 },
        desiredPluginProjection: pluginProjection.map((element) => ({
          ...element,
          zIndex: 42,
        })),
      }),
    });

    expect(mocks.buildSaved).toHaveBeenCalledTimes(1);
    const built = mocks.buildSaved.mock.results[0].value as string[];
    expect(built).toEqual(['plugin-a:plugin-a:one:42']);
    // 성공 후 main store도 desired로 정렬 (prepare 동적 편입분 포함 계약)
    expect(mocks.setElements).toHaveBeenCalledTimes(1);
    const [mergedElements] = mocks.setElements.mock.calls[0] as unknown as [
      Array<{ fullId: string; zIndex?: number }>,
    ];
    expect(mergedElements[0]).toMatchObject({
      fullId: 'plugin-a:one',
      zIndex: 42,
    });
  });

  it('삭제 ops는 재주입된 대상을 desired에서 제거하고 신규 요소를 보존한다', async () => {
    // 요소 id = 저장 instanceId(UUID), fullId = pluginId::instanceId
    const target = {
      fullId: 'plugin-a::30000000-0000-4000-8000-000000000001',
      definitionId: 'plugin-a',
      zIndex: 0,
    };
    const survivor = {
      fullId: 'plugin-a::30000000-0000-4000-8000-000000000002',
      definitionId: 'plugin-a',
      zIndex: 1,
    };
    const newcomer = {
      fullId: 'plugin-a::30000000-0000-4000-8000-000000000003',
      definitionId: 'plugin-a',
      zIndex: 2,
    };
    mocks.elements = [target, survivor];
    mocks.gestureCommit.mockResolvedValueOnce({
      editorRevision: 2,
      changedFields: ['keys', 'keyPositions'],
      editorOpResults: [{ status: 'applied' }],
      changedPluginIds: ['plugin-a'],
      pluginModelRevision: 2,
      authorityGeneration: 1,
    });

    await commitMixedGestureIntent({
      gestureId: 'gesture-delete',
      initialPluginIds: ['plugin-a'],
      pluginScope: () => ['plugin-a'],
      generate: ({ pluginProjection }) => {
        // 봉인 뒤 다음 gesture가 대상과 신규 요소를 다시 store에 넣은 상황
        mocks.elements = [...pluginProjection, newcomer];
        return {
          kind: 'ops',
          ops: [
            {
              kind: 'deleteElement',
              elementType: 'key',
              id: 'native-id',
            },
          ],
          desiredPluginProjection: pluginProjection.filter(
            (element) => element.fullId !== target.fullId,
          ),
        };
      },
    });

    expect(mocks.gestureCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        editorOpsVersion: EDITOR_OPS_VERSION,
        editorOps: [
          {
            kind: 'deleteElement',
            elementType: 'key',
            id: 'native-id',
          },
        ],
        pluginChanges: [
          {
            pluginId: 'plugin-a',
            instances: [
              'plugin-a:plugin-a::30000000-0000-4000-8000-000000000002:1',
            ],
          },
        ],
      }),
    );
    const [merged] = mocks.setElements.mock.calls.at(-1) as unknown as [
      Array<{ fullId: string }>,
    ];
    expect(merged.map((element) => element.fullId)).toEqual([
      survivor.fullId,
      newcomer.fullId,
    ]);
  });

  it('동적 발견 plugin은 stage 후 rotate되고 다음 drain이 관측한다', async () => {
    // 첫 drain 뒤 신규 plugin-b 출현 - scope가 성장하는 순서 구성
    let drainCount = 0;
    mocks.drainQueues.mockImplementation(() => {
      drainCount += 1;
      return Promise.resolve();
    });
    const generatorSpy = vi.fn(() => ({
      kind: 'patch' as const,
      patch: { schemaVersion: 1 as const },
    }));
    await commitMixedGestureIntent({
      gestureId: 'gesture-discover',
      initialPluginIds: ['plugin-a'],
      pluginScope: () =>
        drainCount >= 1 ? ['plugin-a', 'plugin-b'] : ['plugin-a'],
      generate: generatorSpy,
    });

    // 발견분 rotate가 같은 게스처로 - 이후 drain·generator보다 앞선다
    expect(mocks.rotateSession).toHaveBeenCalledWith(
      'plugin-b',
      'gesture-discover',
    );
    const stageBIndex = mocks.stageGesture.mock.calls.findIndex(
      (call) => (call as unknown[])[0] === 'plugin-b',
    );
    expect(stageBIndex).toBeGreaterThanOrEqual(0);
    const stageBOrder =
      mocks.stageGesture.mock.invocationCallOrder[stageBIndex];
    const rotateOrder = mocks.rotateSession.mock.invocationCallOrder[0];
    const lastDrainOrder =
      mocks.drainQueues.mock.invocationCallOrder[
        mocks.drainQueues.mock.calls.length - 1
      ];
    const generatorOrder = generatorSpy.mock.invocationCallOrder[0];
    expect(stageBOrder).toBeLessThan(rotateOrder);
    expect(rotateOrder).toBeLessThan(lastDrainOrder);
    expect(lastDrainOrder).toBeLessThan(generatorOrder);
  });

  it('초기 scope가 비어도 prepare 중 발견한 plugin을 editor ops와 함께 저장한다', async () => {
    mocks.elements = [
      {
        fullId: 'plugin-b:new',
        definitionId: 'plugin-b',
        zIndex: 0,
      },
    ];
    await commitMixedGestureIntent({
      gestureId: 'gesture-empty-discover',
      initialPluginIds: [],
      pluginScope: (elements) =>
        elements.map((element) => element.definitionId as string),
      generate: ({ pluginProjection }) => ({
        kind: 'ops',
        ops: [
          {
            kind: 'insertFrozenElements',
            mode: '4key',
            elements: [],
            groups: [],
            zUpdates: [
              {
                elementType: 'key',
                id: '00000000-0000-4000-8000-000000000031',
                zIndex: 1,
              },
            ],
          },
        ],
        desiredPluginProjection: pluginProjection.map((element) => ({
          ...element,
          zIndex: 2,
        })),
      }),
    });

    expect(mocks.stageGesture).toHaveBeenCalledWith(
      'plugin-b',
      'gesture-empty-discover',
    );
    expect(mocks.rotateSession).toHaveBeenCalledWith(
      'plugin-b',
      'gesture-empty-discover',
    );
    expect(mocks.editorCommit).not.toHaveBeenCalled();
    expect(mocks.gestureCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        editorOpsVersion: EDITOR_OPS_VERSION,
        editorOps: [expect.objectContaining({ kind: 'insertFrozenElements' })],
        pluginChanges: [
          {
            pluginId: 'plugin-b',
            instances: ['plugin-b:plugin-b:new:2'],
          },
        ],
      }),
    );
  });

  it('비영속 필드만 바뀐 요소도 영속 필드 CAS로 desired z를 적용한다', async () => {
    const handler = () => 'runtime';
    mocks.elements = [
      {
        fullId: 'plugin-a:one',
        definitionId: 'plugin-a',
        zIndex: 0,
        state: { tick: 1 },
        onClick: handler,
      },
    ];
    // commit IPC 사이 런타임 필드만 갱신 (영속 필드는 봉인과 동일)
    mocks.gestureCommit.mockImplementationOnce(async () => {
      mocks.elements = [
        {
          fullId: 'plugin-a:one',
          definitionId: 'plugin-a',
          zIndex: 0,
          state: { tick: 99 },
          onClick: handler,
        },
      ];
      return {
        editorRevision: 1,
        changedFields: [],
        changedPluginIds: [],
        pluginModelRevision: 1,
      };
    });
    await commitMixedGestureIntent({
      gestureId: 'gesture-runtime-churn',
      initialPluginIds: ['plugin-a'],
      pluginScope: () => ['plugin-a'],
      generate: ({ pluginProjection }) => ({
        kind: 'patch',
        patch: { schemaVersion: 1 },
        desiredPluginProjection: pluginProjection.map((element) => ({
          ...element,
          zIndex: 42,
        })),
      }),
    });

    // 전체 객체 비교라면 state 변경이 소유 판정을 깨 z가 미적용된다
    expect(mocks.setElements).toHaveBeenCalledTimes(1);
    const [aligned] = mocks.setElements.mock.calls[0] as unknown as [
      Array<{ fullId: string; zIndex?: number; state?: { tick: number } }>,
    ];
    expect(aligned[0].zIndex).toBe(42);
    // 비영속 필드는 현재 값 보존 (전체 교체라면 tick 1로 되돌아간다)
    expect(aligned[0].state?.tick).toBe(99);
  });

  it('groupId도 영속 필드로 3-way 정렬되어 main store에 반영된다', async () => {
    mocks.elements = [
      {
        fullId: 'plugin-a:one',
        definitionId: 'plugin-a',
        zIndex: 0,
        groupId: undefined,
      },
    ];
    await commitMixedGestureIntent({
      gestureId: 'gesture-group-align',
      initialPluginIds: ['plugin-a'],
      pluginScope: () => ['plugin-a'],
      generate: ({ pluginProjection }) => ({
        kind: 'patch',
        patch: { schemaVersion: 1 },
        desiredPluginProjection: pluginProjection.map((element) => ({
          ...element,
          groupId: 'group-a',
        })),
      }),
    });

    // PERSISTED_FIELDS에 groupId 누락 시 커밋 후 main store 미반영
    expect(mocks.setElements).toHaveBeenCalledTimes(1);
    const [aligned] = mocks.setElements.mock.calls[0] as unknown as [
      Array<{ fullId: string; groupId?: string }>,
    ];
    expect(aligned[0].groupId).toBe('group-a');
  });

  it('봉인 이후 병행 편집된 요소는 desired 정렬이 덮어쓰지 않는다', async () => {
    mocks.elements = [
      { fullId: 'plugin-a:one', definitionId: 'plugin-a', zIndex: 0 },
    ];
    // commit IPC 사이에 병행 편집 발생 (봉인과 다른 현재값)
    mocks.gestureCommit.mockImplementationOnce(async () => {
      mocks.elements = [
        { fullId: 'plugin-a:one', definitionId: 'plugin-a', zIndex: 7 },
      ];
      return {
        editorRevision: 1,
        changedFields: [],
        changedPluginIds: [],
        pluginModelRevision: 1,
      };
    });
    await commitMixedGestureIntent({
      gestureId: 'gesture-concurrent',
      initialPluginIds: ['plugin-a'],
      pluginScope: () => ['plugin-a'],
      generate: ({ pluginProjection }) => ({
        kind: 'patch',
        patch: { schemaVersion: 1 },
        desiredPluginProjection: pluginProjection.map((element) => ({
          ...element,
          zIndex: 42,
        })),
      }),
    });

    // 현재(7) ≠ 봉인(0) - 외부 소유라 stale desired(42)로 덮지 않는다
    expect(mocks.setElements).not.toHaveBeenCalled();
  });

  it('desired 정렬은 커밋된 삭제를 적용하고 봉인 후 신규 요소는 보존한다', async () => {
    // 요소 id = 저장 instanceId(UUID), fullId = pluginId::instanceId
    const goneFullId = 'plugin-a::30000000-0000-4000-8000-000000000011';
    const newFullId = 'plugin-a::30000000-0000-4000-8000-000000000012';
    mocks.elements = [
      { fullId: goneFullId, definitionId: 'plugin-a', zIndex: 0 },
    ];
    // commit IPC 사이: 삭제 대상이 같은 fullId로 재주입되고 봉인 후 신규도 등장
    mocks.gestureCommit.mockImplementationOnce(async () => {
      mocks.elements = [
        { fullId: goneFullId, definitionId: 'plugin-a', zIndex: 0 },
        { fullId: newFullId, definitionId: 'plugin-a', zIndex: 3 },
      ];
      return {
        editorRevision: 1,
        changedFields: [],
        changedPluginIds: [],
        pluginModelRevision: 1,
      };
    });
    await commitMixedGestureIntent({
      gestureId: 'gesture-delete-align',
      initialPluginIds: ['plugin-a'],
      pluginScope: () => ['plugin-a'],
      // 삭제 의도: desired가 대상을 제외
      generate: () => ({
        kind: 'patch',
        patch: { schemaVersion: 1 },
        desiredPluginProjection: [],
      }),
    });

    expect(mocks.setElements).toHaveBeenCalledTimes(1);
    const [aligned] = mocks.setElements.mock.calls[0] as unknown as [
      Array<{ fullId: string }>,
    ];
    const ids = aligned.map((element) => element.fullId);
    // 커밋된 삭제 적용 + 봉인 후 신규 보존
    expect(ids).not.toContain(goneFullId);
    expect(ids).toContain(newFullId);
  });

  it('편입 후 실패는 onFailureBeforeSettle에 알리고 canonical pull 후 settle한다', async () => {
    mocks.elements = [
      { fullId: 'plugin-a:one', definitionId: 'plugin-a', zIndex: 0 },
    ];
    mocks.gestureCommit.mockRejectedValueOnce(new Error('backend failed'));
    const onFailure = vi.fn();

    await expect(
      commitMixedGestureIntent({
        gestureId: 'gesture-fail',
        initialPluginIds: ['plugin-a'],
        pluginScope: () => ['plugin-a'],
        generate: () => ({ kind: 'patch', patch: { schemaVersion: 1 } }),
        onFailureBeforeSettle: onFailure,
      }),
    ).rejects.toThrow('backend failed');

    expect(onFailure).toHaveBeenCalledTimes(1);
    const failureOrder = onFailure.mock.invocationCallOrder[0];
    const canonicalOrder = mocks.applyCanonical.mock.invocationCallOrder[0];
    const unstageOrder = mocks.unstageGesture.mock.invocationCallOrder[0];
    expect(failureOrder).toBeLessThan(canonicalOrder);
    expect(canonicalOrder).toBeLessThan(unstageOrder);
  });
});
