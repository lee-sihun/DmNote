// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';
import { EDITOR_OPS_VERSION } from '@src/types/editor';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';

const mocks = vi.hoisted(() => ({
  gestureCommit: vi.fn((_request: unknown) =>
    Promise.resolve({
      editorRevision: 1,
      changedFields: ['keyPositions'],
      editorOpResults: [{ status: 'applied' }],
      changedPluginIds: ['plugin-a'],
      pluginModelRevision: 1,
      authorityGeneration: 0,
    }),
  ),
  editorCommit: vi.fn(() =>
    Promise.resolve({ revision: 1, changedFields: [] }),
  ),
  drainQueues: vi.fn(() => Promise.resolve()),
  rotateSession: vi.fn(),
  commitBatchGeometryByIds: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('@api/modules/gestureApi', () => ({
  gestureApi: { commit: mocks.gestureCommit },
}));

vi.mock('@api/modules/editorApi', () => ({
  editorApi: { commit: mocks.editorCommit },
}));

vi.mock('@api/modules/pluginInstancesApi', () => ({
  pluginInstancesApi: {
    commit: vi.fn(() => Promise.resolve({ modelRevision: 1, changed: false })),
    reconcile: vi.fn(() =>
      Promise.resolve({ modelRevision: 1, changed: false }),
    ),
    get: vi.fn(),
    onChanged: vi.fn(() => () => undefined),
  },
}));

vi.mock('@src/renderer/editor/runtime/editorStateCoordinator', () => ({
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
        // 슬롯 재계획 generator를 위해 현재 스토어로 canonical base 구성
        const [keyStore, statStore, graphStore, knobStore, groupStore] =
          await Promise.all([
            import('@stores/data/useKeyStore'),
            import('@stores/data/useStatItemStore'),
            import('@stores/data/useGraphItemStore'),
            import('@stores/data/useKnobItemStore'),
            import('@stores/data/useLayerGroupStore'),
          ]);
        const base = {
          schemaVersion: 1,
          keys: keyStore.useKeyStore.getState().keyMappings,
          keyPositions: keyStore.useKeyStore.getState().canonicalPositions,
          statPositions: statStore.useStatItemStore.getState().positions,
          graphPositions: graphStore.useGraphItemStore.getState().positions,
          knobPositions: knobStore.useKnobItemStore.getState().positions,
          layerGroups: groupStore.useLayerGroupStore.getState().layerGroups,
        };
        const mutation =
          typeof changes === 'function'
            ? (changes as (base: unknown) => unknown)(base)
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
            ? { editorChanges: mutation }
            : {}),
        });
        return {};
      },
    ),
    getState: () => ({ lastAck: null }),
  },
  captureEditorDocument: () => ({
    schemaVersion: 1,
    keys: {},
    keyPositions: {},
    statPositions: {},
    graphPositions: {},
    knobPositions: {},
    layerGroups: {},
  }),
}));

vi.mock('@src/renderer/editor/runtime/elementOps', async (importOriginal) => {
  // op 구성·eager projection은 실물, 배치 위임 경계만 mock
  const actual = await importOriginal<
    typeof import('@src/renderer/editor/runtime/elementOps')
  >();
  return {
    ...actual,
    commitBatchGeometryByIds: mocks.commitBatchGeometryByIds,
  };
});

vi.mock('@src/renderer/editor/runtime/editorWriteBarrier', () => ({
  trackEditorWrite: <T>(promise: T) => promise,
}));

vi.mock('@src/renderer/editor/runtime/editorCompatibilityQueue', () => ({
  enqueueEditorCompatibilityOperation: vi.fn(),
}));

vi.mock('@plugins/runtime/displayElement/instancesUndoSync', () => ({
  applyCanonicalPluginInstances: vi.fn(() => Promise.resolve()),
  notePluginInstancesMutation: vi.fn(),
  registerPluginInstancesReapplier: vi.fn(() => () => undefined),
}));

vi.mock('@plugins/runtime/displayElement/instancesCommitQueue', () => ({
  createPluginInstancesSaveDebounce: () => ({
    schedule: vi.fn(),
    flush: vi.fn(),
    cancel: vi.fn(),
  }),
  drainPluginInstancesCommitQueues: mocks.drainQueues,
  enqueuePluginInstancesCommit: (
    _pluginId: string,
    task: () => Promise<unknown>,
  ) => task(),
  getStagedPluginInstancesGestureId: () => null,
  hasConflictingPluginInstancesGesture: () => false,
  isPluginInstancesGestureStaged: () => false,
  registerPluginInstancesEditSessionFlush: () => () => undefined,
  registerPluginInstancesStagedRelease: () => () => undefined,
  rotatePluginInstancesEditSession: mocks.rotateSession,
  stagePluginInstancesGesture: vi.fn(),
  touchPluginInstancesEditSession: () => 'session-token',
  unstagePluginInstancesGesture: vi.fn(),
}));

vi.mock('@utils/plugin/panelModelSync', () => ({
  schedulePluginPanelModelSync: vi.fn(),
  flushPluginPanelModelSyncNow: vi.fn(),
  getPluginPanelModelRevision: () => 0,
}));

vi.mock('@utils/plugin/bridgeMessages', () => ({
  sendBridgeMessageBestEffort: vi.fn(),
}));

vi.mock('@plugins/runtime/pluginAuthorityGeneration', () => ({
  getPluginAuthorityGeneration: () => 0,
}));

vi.mock('@plugins/runtime/pluginModelRevision', () => ({
  getBackendPluginRevision: () => 0,
  noteBackendPluginRevision: vi.fn(),
}));

vi.mock('@stores/data/useHistoryStatusStore', () => ({
  useHistoryStatusStore: { getState: () => ({ historyEpoch: 0 }) },
  syncHistoryStatus: vi.fn(),
}));

import { commitMixedBatchGeometry } from './mixedBatchGeometry';

import type { BatchGeometryDescriptor } from './elementOps';

const KEY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INSTANCE_ID = '10000000-0000-4000-8000-000000000001';
const FULL_ID = `plugin-a::${INSTANCE_ID}`;
const SECOND_INSTANCE_ID = '10000000-0000-4000-8000-000000000002';
const SECOND_FULL_ID = `plugin-a::${SECOND_INSTANCE_ID}`;
const GESTURE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const pluginElement = (
  overrides: Partial<PluginDisplayElementInternal> = {},
): PluginDisplayElementInternal =>
  ({
    id: INSTANCE_ID,
    fullId: FULL_ID,
    pluginId: 'plugin-a',
    definitionId: 'plugin-a',
    position: { x: 100, y: 0 },
    estimatedSize: { width: 50, height: 50 },
    tabId: '4key',
    zIndex: 0,
    ...overrides,
  } as never);

const seedStores = (
  overrides: {
    keyPosition?: Partial<ReturnType<typeof createDefaultKeyPosition>>;
    plugin?: Partial<PluginDisplayElementInternal>;
  } = {},
) => {
  const position = {
    ...createDefaultKeyPosition(),
    id: KEY_ID,
    ...overrides.keyPosition,
  };
  useKeyStore.setState({
    keyMappings: { '4key': [''] },
    canonicalPositions: { '4key': [position] },
    positions: { '4key': [position] },
  } as never);
  useStatItemStore.setState({ positions: {} });
  useGraphItemStore.setState({ positions: {} });
  useKnobItemStore.setState({ positions: {} });
  useLayerGroupStore.setState({ layerGroups: {} });
  usePluginDisplayElementStore.setState({
    elements: [pluginElement(overrides.plugin)],
  });
};

const alignDescriptor = (
  direction: 'left' | 'centerH' = 'left',
): BatchGeometryDescriptor => ({
  mode: '4key',
  targets: [{ type: 'key', id: KEY_ID }],
  operation: { kind: 'align', direction },
});

describe('commitMixedBatchGeometry', () => {
  beforeEach(() => {
    mocks.gestureCommit.mockClear();
    mocks.editorCommit.mockClear();
    mocks.drainQueues.mockClear();
    mocks.drainQueues.mockResolvedValue(undefined);
    mocks.rotateSession.mockClear();
    mocks.commitBatchGeometryByIds.mockClear();
    seedStores();
  });

  it('혼합 정렬은 단일 gestureId 커밋에 setBounds op와 position pluginChanges를 함께 싣는다', async () => {
    // key 0..60, plugin 100..150 - align left로 plugin만 이동
    await expect(
      commitMixedBatchGeometry(alignDescriptor('left'), [FULL_ID]),
    ).resolves.toBe(true);

    // undo 원자성: gesture 커밋 1회에 양쪽 변경이 모두 실린다
    expect(mocks.gestureCommit).toHaveBeenCalledTimes(1);
    const request = mocks.gestureCommit.mock.calls[0]?.[0] as unknown as {
      gestureId: string;
      editorOps: unknown[];
      pluginChanges: Array<{
        pluginId: string;
        instances: Array<Record<string, unknown>>;
      }>;
    };
    expect(request.gestureId).toEqual(expect.any(String));
    expect(request.editorOps).toEqual([
      {
        kind: 'setBounds',
        elementType: 'key',
        id: KEY_ID,
        bounds: { dx: 0, dy: 0, width: 60, height: 60 },
      },
    ]);
    expect(request.pluginChanges).toEqual([
      {
        pluginId: 'plugin-a',
        instances: [
          expect.objectContaining({
            instanceId: INSTANCE_ID,
            position: { x: 0, y: 0 },
          }),
        ],
      },
    ]);
    // eager: 양쪽 저장소 모두 반영
    expect(
      usePluginDisplayElementStore.getState().elements[0].position,
    ).toEqual({ x: 0, y: 0 });
    expect(useKeyStore.getState().canonicalPositions['4key'][0].dx).toBe(0);
    expect(mocks.commitBatchGeometryByIds).not.toHaveBeenCalled();
  });

  it('desired projection은 plugin position만 바꾸고 다른 영속 필드는 보존한다', async () => {
    await expect(
      commitMixedBatchGeometry(alignDescriptor('left'), [FULL_ID]),
    ).resolves.toBe(true);

    const request = mocks.gestureCommit.mock.calls[0]?.[0] as unknown as {
      pluginChanges: Array<{ instances: Array<Record<string, unknown>> }>;
    };
    expect(request.pluginChanges[0].instances[0]).toEqual({
      instanceId: INSTANCE_ID,
      position: { x: 0, y: 0 },
      tabId: '4key',
      hidden: false,
      zIndex: 0,
    });
  });

  it('옵션 gestureId(간격 세션)는 그대로 커밋 gestureId로 쓴다', async () => {
    await expect(
      commitMixedBatchGeometry(alignDescriptor('left'), [FULL_ID], {
        gestureId: GESTURE_ID,
      }),
    ).resolves.toBe(true);

    const request = mocks.gestureCommit.mock.calls[0]?.[0] as unknown as {
      gestureId: string;
    };
    expect(request.gestureId).toBe(GESTURE_ID);
  });

  it('plugin 대상이 없으면 기존 native 전용 경로에 위임한다', async () => {
    const descriptor = alignDescriptor('left');
    await expect(commitMixedBatchGeometry(descriptor, [])).resolves.toBe(true);

    expect(mocks.commitBatchGeometryByIds).toHaveBeenCalledWith(descriptor, {});
    expect(mocks.gestureCommit).not.toHaveBeenCalled();
  });

  it('resize에 plugin이 섞이면 fail-closed로 거절한다', async () => {
    await expect(
      commitMixedBatchGeometry(
        {
          mode: '4key',
          targets: [{ type: 'key', id: KEY_ID }],
          operation: { kind: 'resize', dimension: 'width', value: 90 },
        },
        [FULL_ID],
      ),
    ).resolves.toBe(false);

    expect(mocks.gestureCommit).not.toHaveBeenCalled();
    expect(mocks.commitBatchGeometryByIds).not.toHaveBeenCalled();
    // eager 미적용
    expect(
      usePluginDisplayElementStore.getState().elements[0].position,
    ).toEqual({ x: 100, y: 0 });
    expect(useKeyStore.getState().canonicalPositions['4key'][0].width).toBe(60);
  });

  it('plugin 대상 소실은 fail-closed로 커밋하지 않는다', async () => {
    await expect(
      commitMixedBatchGeometry(alignDescriptor('left'), ['plugin-a::missing']),
    ).resolves.toBe(false);

    expect(mocks.gestureCommit).not.toHaveBeenCalled();
    expect(
      usePluginDisplayElementStore.getState().elements[0].position,
    ).toEqual({ x: 100, y: 0 });
  });

  it('모드 밖 plugin 대상은 fail-closed로 커밋하지 않는다', async () => {
    seedStores({ plugin: { tabId: '7key' } });

    await expect(
      commitMixedBatchGeometry(alignDescriptor('left'), [FULL_ID]),
    ).resolves.toBe(false);

    expect(mocks.gestureCommit).not.toHaveBeenCalled();
  });

  it('슬롯 재계획 시점의 모드 이탈은 전체 중단하고 eager를 전량 복원한다', async () => {
    // centerH: key 100→50, plugin 0→55로 양쪽 모두 이동
    seedStores({
      keyPosition: { dx: 100 },
      plugin: { position: { x: 0, y: 0 } },
    });
    mocks.drainQueues.mockImplementationOnce(async () => {
      // eager 이후, 봉인 직전의 모드 이탈 재현
      const store = usePluginDisplayElementStore.getState();
      store.setElements([{ ...store.elements[0], tabId: '7key' } as never]);
    });

    await expect(
      commitMixedBatchGeometry(alignDescriptor('centerH'), [FULL_ID]),
    ).resolves.toBe(false);

    expect(mocks.gestureCommit).not.toHaveBeenCalled();
    // native·plugin eager 모두 CAS 복원
    expect(useKeyStore.getState().canonicalPositions['4key'][0].dx).toBe(100);
    expect(
      usePluginDisplayElementStore.getState().elements[0].position,
    ).toEqual({ x: 0, y: 0 });
  });

  it('편입 전 실패는 native·plugin eager를 CAS로 복원한다', async () => {
    seedStores({
      keyPosition: { dx: 100 },
      plugin: { position: { x: 0, y: 0 } },
    });
    mocks.drainQueues.mockRejectedValueOnce(new Error('drain failed'));

    await expect(
      commitMixedBatchGeometry(alignDescriptor('centerH'), [FULL_ID]),
    ).rejects.toThrow('drain failed');

    expect(mocks.gestureCommit).not.toHaveBeenCalled();
    expect(useKeyStore.getState().canonicalPositions['4key'][0].dx).toBe(100);
    expect(
      usePluginDisplayElementStore.getState().elements[0].position,
    ).toEqual({ x: 0, y: 0 });
  });

  describe('plugin 단독 배치 (native 대상 0개)', () => {
    const pluginOnlyDescriptor = (): BatchGeometryDescriptor => ({
      mode: '4key',
      targets: [],
      operation: { kind: 'align', direction: 'left' },
    });

    const seedTwoPlugins = () => {
      usePluginDisplayElementStore.setState({
        elements: [
          pluginElement(),
          pluginElement({
            id: SECOND_INSTANCE_ID,
            fullId: SECOND_FULL_ID,
            position: { x: 200, y: 40 },
          }),
        ],
      });
    };

    it('plugin 단독 커밋은 editor 페이로드 없이 pluginChanges만 싣는다 (EMPTY_EDITOR_OPS 회피)', async () => {
      seedTwoPlugins();

      await expect(
        commitMixedBatchGeometry(pluginOnlyDescriptor(), [
          FULL_ID,
          SECOND_FULL_ID,
        ]),
      ).resolves.toBe(true);

      expect(mocks.gestureCommit).toHaveBeenCalledTimes(1);
      const request = mocks.gestureCommit.mock.calls[0]?.[0] as Record<
        string,
        unknown
      >;
      // patch:null 경로 - 빈 editorOps 배열을 실으면 백엔드가
      // EMPTY_EDITOR_OPS로 거절하므로 editor 페이로드 자체가 없어야 한다
      expect(request).not.toHaveProperty('editorOps');
      expect(request).not.toHaveProperty('editorOpsVersion');
      expect(request).not.toHaveProperty('editorChanges');
      // undo 스냅샷 전제: gesture 커밋 1회에 pluginChanges만 실린다
      expect(request.pluginChanges).toEqual([
        {
          pluginId: 'plugin-a',
          instances: [
            expect.objectContaining({
              instanceId: INSTANCE_ID,
              position: { x: 100, y: 0 },
            }),
            expect.objectContaining({
              instanceId: SECOND_INSTANCE_ID,
              position: { x: 100, y: 40 },
            }),
          ],
        },
      ]);
      // eager: plugin position 반영
      expect(
        usePluginDisplayElementStore
          .getState()
          .elements.map((element) => element.position),
      ).toEqual([
        { x: 100, y: 0 },
        { x: 100, y: 40 },
      ]);
      expect(mocks.commitBatchGeometryByIds).not.toHaveBeenCalled();
    });

    it('plugin 1개 단독은 합산 최소 미달로 거절한다', async () => {
      await expect(
        commitMixedBatchGeometry(pluginOnlyDescriptor(), [FULL_ID]),
      ).resolves.toBe(false);

      expect(mocks.gestureCommit).not.toHaveBeenCalled();
      expect(mocks.commitBatchGeometryByIds).not.toHaveBeenCalled();
      expect(
        usePluginDisplayElementStore.getState().elements[0].position,
      ).toEqual({ x: 100, y: 0 });
    });
  });

  it('편입 전 실패라도 병행 편집된 position은 CAS가 보존한다', async () => {
    seedStores({
      keyPosition: { dx: 100 },
      plugin: { position: { x: 0, y: 0 } },
    });
    mocks.drainQueues.mockImplementationOnce(async () => {
      // eager 이후, 실패 이전의 병행 편집 재현
      const store = usePluginDisplayElementStore.getState();
      store.setElements([
        { ...store.elements[0], position: { x: 999, y: 999 } } as never,
      ]);
      throw new Error('drain failed');
    });

    await expect(
      commitMixedBatchGeometry(alignDescriptor('centerH'), [FULL_ID]),
    ).rejects.toThrow('drain failed');

    // 우리가 쓴 값이 아니므로 복원하지 않는다
    expect(
      usePluginDisplayElementStore.getState().elements[0].position,
    ).toEqual({ x: 999, y: 999 });
  });
});
