import { afterEach, describe, expect, it, vi } from 'vitest';

import { drainEditorWrites } from '@src/renderer/editor/runtime/editorWriteBarrier';
import {
  beginMixedGestureTransaction,
  cancelMixedGestureTransaction,
  cancelUncommittedMixedGestureTransaction,
  commitMixedGestureTransaction,
} from './gestureTransaction';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

const mocks = vi.hoisted(() => {
  const stagedOwners = new Map<string, string>();
  return {
    commitGesture: vi.fn(),
    commitApi: vi.fn(),
    stagedOwners,
    stage: vi.fn((pluginId: string, gestureId: string) => {
      stagedOwners.set(pluginId, gestureId);
    }),
    unstage: vi.fn((pluginId: string, gestureId: string) => {
      if (stagedOwners.get(pluginId) === gestureId) {
        stagedOwners.delete(pluginId);
      }
    }),
    drainQueues: vi.fn(() => Promise.resolve()),
    hasConflictingGesture: vi.fn(
      (_pluginId?: string, _gestureId?: string) => false,
    ),
    applyCanonical: vi.fn(() => Promise.resolve()),
    noteMutation: vi.fn(),
    noteRevision: vi.fn(),
    buildSaved: vi.fn(
      (
        elements: Array<{
          definitionId: string;
          position: { x: number; y: number };
        }>,
        pluginId: string,
      ) =>
        elements
          .filter((element) => element.definitionId === pluginId)
          .map((element) => ({ position: { ...element.position } })),
    ),
    elements: [] as Array<{
      definitionId: string;
      pluginId: string;
      position: { x: number; y: number };
    }>,
    definitions: new Map(),
    modelRevision: 5,
    schedulePanel: vi.fn(),
  };
});

vi.mock('@src/renderer/editor/runtime/editorStateCoordinator', () => ({
  editorCoordinator: { commitGesture: mocks.commitGesture },
}));

vi.mock('@api/modules/gestureApi', () => ({
  gestureApi: { commit: mocks.commitApi },
}));

vi.mock('./instancesCommitQueue', () => ({
  stagePluginInstancesGesture: mocks.stage,
  unstagePluginInstancesGesture: mocks.unstage,
  getStagedPluginInstancesGestureId: (pluginId: string) =>
    mocks.stagedOwners.get(pluginId),
  drainPluginInstancesCommitQueues: mocks.drainQueues,
  hasConflictingPluginInstancesGesture: mocks.hasConflictingGesture,
}));

vi.mock('./instancesUndoSync', () => ({
  applyCanonicalPluginInstances: mocks.applyCanonical,
  notePluginInstancesMutation: mocks.noteMutation,
}));

vi.mock('../api/defineElement', () => ({
  buildSavedPluginInstances: mocks.buildSaved,
}));

vi.mock('@stores/plugin/usePluginDisplayElementStore', () => ({
  usePluginDisplayElementStore: {
    getState: () => ({
      elements: mocks.elements,
      definitions: mocks.definitions,
    }),
  },
}));

vi.mock('@stores/data/useHistoryStatusStore', () => ({
  useHistoryStatusStore: { getState: () => ({ historyEpoch: 7 }) },
}));

vi.mock('@plugins/rpc/pluginRpcClient', () => ({
  getPluginAuthorityGeneration: () => 3,
}));

vi.mock('@plugins/rpc/pluginModelRevision', () => ({
  getBackendPluginRevision: () => mocks.modelRevision,
  noteBackendPluginRevision: mocks.noteRevision,
}));

vi.mock('@utils/plugin/panelModelSync', () => ({
  schedulePluginPanelModelSync: mocks.schedulePanel,
}));

describe('mixed gesture transaction lifecycle', () => {
  const gestureId = '00000000-0000-4000-8000-0000000000f4';
  const nextGestureId = '00000000-0000-4000-8000-0000000000f5';

  afterEach(async () => {
    cancelMixedGestureTransaction(gestureId);
    cancelMixedGestureTransaction(nextGestureId);
    await drainEditorWrites();
    mocks.elements = [];
    mocks.modelRevision = 5;
    mocks.stagedOwners.clear();
    vi.clearAllMocks();
    mocks.hasConflictingGesture.mockImplementation(() => false);
  });

  it('keeps history drain pending until an active gesture is finalized or canceled', async () => {
    beginMixedGestureTransaction(gestureId, ['plugin-a']);
    let drained = false;
    const draining = drainEditorWrites().then((result) => {
      drained = true;
      return result;
    });

    await Promise.resolve();
    expect(drained).toBe(false);
    expect(mocks.stage).toHaveBeenCalledWith('plugin-a', gestureId);

    cancelMixedGestureTransaction(gestureId);
    await expect(draining).resolves.toBe(true);
    expect(mocks.unstage).toHaveBeenCalledWith('plugin-a', gestureId);
  });

  it('미커밋 cleanup은 selection이 비혼합으로 끝나도 barrier를 해제한다', async () => {
    beginMixedGestureTransaction(gestureId, ['plugin-a']);

    cancelUncommittedMixedGestureTransaction(gestureId);

    await expect(drainEditorWrites()).resolves.toBe(true);
    expect(mocks.unstage).toHaveBeenCalledWith('plugin-a', gestureId);
  });

  it('queue 대기 중 후속 plugin 편집을 실행 시점 스냅샷으로 커밋한다', async () => {
    const queueDrain = deferred<void>();
    const apiCommit = deferred<{
      editorRevision: number;
      changedFields: [];
      pluginModelRevision: number;
      changedPluginIds: string[];
      authorityGeneration: number;
    }>();
    mocks.drainQueues.mockReturnValueOnce(queueDrain.promise);
    mocks.commitApi.mockReturnValueOnce(apiCommit.promise);
    mocks.commitGesture.mockImplementationOnce(
      async (_changes, _gestureId, commit) => {
        await commit({
          editorBaseRevision: 2,
          mutationId: 'mutation-a',
          editorChanges: { schemaVersion: 1, statPositions: {} },
        });
      },
    );
    mocks.elements = [
      {
        definitionId: 'plugin-a',
        pluginId: 'plugin-a',
        position: { x: 10, y: 20 },
      },
    ];

    const committing = commitMixedGestureTransaction(
      gestureId,
      { schemaVersion: 1, statPositions: {} },
      ['plugin-a'],
    );
    await vi.waitFor(() => expect(mocks.drainQueues).toHaveBeenCalledOnce());

    mocks.elements = [
      {
        definitionId: 'plugin-a',
        pluginId: 'plugin-a',
        position: { x: 20, y: 20 },
      },
    ];
    mocks.modelRevision = 6;
    queueDrain.resolve(undefined);
    await vi.waitFor(() => expect(mocks.commitApi).toHaveBeenCalledOnce());
    expect(mocks.commitApi.mock.calls[0]?.[0].pluginChanges).toEqual([
      { pluginId: 'plugin-a', instances: [{ position: { x: 20, y: 20 } }] },
    ]);
    expect(mocks.commitApi.mock.calls[0]?.[0].pluginBaseRevision).toBe(6);

    const committedElements = mocks.elements;
    mocks.elements = [
      {
        definitionId: 'plugin-a',
        pluginId: 'plugin-a',
        position: { x: 30, y: 20 },
      },
    ];
    apiCommit.resolve({
      editorRevision: 2,
      changedFields: [],
      pluginModelRevision: 7,
      changedPluginIds: ['plugin-a'],
      authorityGeneration: 3,
    });
    await committing;

    expect(mocks.schedulePanel).toHaveBeenCalledWith(
      committedElements,
      mocks.definitions,
      7,
    );
  });

  it('후속 혼합 gesture가 같은 plugin을 넘겨받아도 앞 gesture 스냅샷을 보존한다', async () => {
    const coordinatorDone = deferred<void>();
    let executeCommit:
      | ((context: {
          editorBaseRevision: number;
          mutationId: string;
          editorChanges: { schemaVersion: 1; statPositions: object };
        }) => Promise<{ revision: number; changedFields: [] }>)
      | undefined;
    mocks.commitGesture.mockImplementationOnce(
      (_changes, _gestureId, commit) => {
        executeCommit = commit;
        return coordinatorDone.promise;
      },
    );
    mocks.commitApi.mockResolvedValueOnce({
      editorRevision: 2,
      changedFields: [],
      pluginModelRevision: 6,
      changedPluginIds: ['plugin-a'],
      authorityGeneration: 3,
    });
    mocks.elements = [
      {
        definitionId: 'plugin-a',
        pluginId: 'plugin-a',
        position: { x: 10, y: 20 },
      },
    ];
    beginMixedGestureTransaction(gestureId, ['plugin-a']);

    const committing = commitMixedGestureTransaction(
      gestureId,
      { schemaVersion: 1, statPositions: {} },
      ['plugin-a'],
    );
    await vi.waitFor(() => expect(executeCommit).toBeDefined());

    beginMixedGestureTransaction(nextGestureId, ['plugin-a']);
    mocks.elements = [
      {
        definitionId: 'plugin-a',
        pluginId: 'plugin-a',
        position: { x: 20, y: 20 },
      },
    ];
    await executeCommit?.({
      editorBaseRevision: 2,
      mutationId: 'mutation-a',
      editorChanges: { schemaVersion: 1, statPositions: {} },
    });
    coordinatorDone.resolve(undefined);
    await committing;

    expect(mocks.commitApi.mock.calls[0]?.[0].pluginChanges).toEqual([
      { pluginId: 'plugin-a', instances: [{ position: { x: 10, y: 20 } }] },
    ]);
    expect(mocks.stagedOwners.get('plugin-a')).toBe(nextGestureId);
  });

  it('안정 bounds 혼합 transaction은 editor ops와 ordered 결과를 보존한다', async () => {
    let coordinatorResult: unknown;
    mocks.commitGesture.mockImplementationOnce(
      async (_changes, _gestureId, commit) => {
        coordinatorResult = await commit({
          editorBaseRevision: 2,
          mutationId: 'mutation-ops',
          editorOpsVersion: 1,
          editorOps: [
            {
              kind: 'setBounds',
              elementType: 'key',
              id: 'id-a',
              bounds: { dx: 1, dy: 2, width: 3, height: 4 },
            },
          ],
        });
      },
    );
    mocks.commitApi.mockResolvedValueOnce({
      editorRevision: 3,
      changedFields: ['keyPositions'],
      editorOpResults: [
        {
          status: 'applied',
          bounds: { dx: 1, dy: 2, width: 3, height: 4 },
        },
      ],
      pluginModelRevision: 6,
      changedPluginIds: ['plugin-a'],
      authorityGeneration: 3,
    });

    await commitMixedGestureTransaction(
      gestureId,
      {
        opsVersion: 1,
        ops: [
          {
            kind: 'setBounds',
            elementType: 'key',
            id: 'id-a',
            bounds: { dx: 1, dy: 2, width: 3, height: 4 },
          },
        ],
      },
      ['plugin-a'],
    );

    expect(mocks.commitApi).toHaveBeenCalledWith(
      expect.objectContaining({
        editorOpsVersion: 1,
        editorOps: [expect.objectContaining({ id: 'id-a' })],
        pluginChanges: [expect.objectContaining({ pluginId: 'plugin-a' })],
      }),
    );
    expect(coordinatorResult).toEqual({
      revision: 3,
      changedFields: ['keyPositions'],
      opResults: [
        {
          status: 'applied',
          bounds: { dx: 1, dy: 2, width: 3, height: 4 },
        },
      ],
    });
  });

  it('reapplies every plugin canonical snapshot when the transaction fails', async () => {
    const error = new Error('plugin validation failed');
    mocks.commitGesture.mockRejectedValueOnce(error);
    beginMixedGestureTransaction(gestureId, ['plugin-a', 'plugin-b']);

    await expect(
      commitMixedGestureTransaction(
        gestureId,
        { schemaVersion: 1, statPositions: {} },
        ['plugin-a', 'plugin-b'],
      ),
    ).rejects.toBe(error);

    expect(mocks.applyCanonical.mock.calls).toEqual([
      ['plugin-a', true],
      ['plugin-b', true],
    ]);
    await expect(drainEditorWrites()).resolves.toBe(true);
  });

  it('releases staging when transaction setup throws synchronously', async () => {
    const error = new Error('editor is read only');
    mocks.commitGesture.mockImplementationOnce(() => {
      throw error;
    });

    await expect(
      commitMixedGestureTransaction(
        gestureId,
        { schemaVersion: 1, statPositions: {} },
        ['plugin-a'],
      ),
    ).rejects.toBe(error);

    expect(mocks.applyCanonical).toHaveBeenCalledWith('plugin-a', true);
    expect(mocks.unstage).toHaveBeenCalledWith('plugin-a', gestureId);
    await expect(drainEditorWrites()).resolves.toBe(true);
  });

  it('실패 복구는 후속 gesture가 소유한 plugin을 재주입하지 않는다', async () => {
    const error = new Error('plugin revision conflict');
    mocks.commitGesture.mockRejectedValueOnce(error);
    mocks.hasConflictingGesture.mockImplementation(
      (pluginId: string) => pluginId === 'plugin-a',
    );
    beginMixedGestureTransaction(gestureId, ['plugin-a', 'plugin-b']);

    await expect(
      commitMixedGestureTransaction(
        gestureId,
        { schemaVersion: 1, statPositions: {} },
        ['plugin-a', 'plugin-b'],
      ),
    ).rejects.toBe(error);

    expect(mocks.applyCanonical).toHaveBeenCalledTimes(1);
    expect(mocks.applyCanonical).toHaveBeenCalledWith('plugin-b', true);
  });
});
