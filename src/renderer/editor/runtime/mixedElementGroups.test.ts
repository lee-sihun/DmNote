// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { useSpriteStore } from '@stores/data/useSpriteStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';
import { EDITOR_OPS_VERSION } from '@src/types/editor';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';

const mocks = vi.hoisted(() => ({
  gestureCommit: vi.fn((_request: unknown) =>
    Promise.resolve({
      editorRevision: 1,
      changedFields: ['layerGroups'],
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
  setElementGroupsByTargets: vi.fn(() => Promise.resolve(true)),
  setLayerGroupHidden: vi.fn(() => Promise.resolve(true)),
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
        // 그룹 멤버를 base에서 재파생하는 generator를 위해 현재 스토어로
        // canonical base를 구성한다 (기존 setElementGroups 경로는 base 미사용)
        const [
          keyStore,
          statStore,
          graphStore,
          knobStore,
          spriteStore,
          groupStore,
        ] = await Promise.all([
          import('@stores/data/useKeyStore'),
          import('@stores/data/useStatItemStore'),
          import('@stores/data/useGraphItemStore'),
          import('@stores/data/useKnobItemStore'),
          import('@stores/data/useSpriteStore'),
          import('@stores/data/useLayerGroupStore'),
        ]);
        const base = {
          schemaVersion: 1,
          keys: keyStore.useKeyStore.getState().keyMappings,
          keyPositions: keyStore.useKeyStore.getState().canonicalPositions,
          statPositions: statStore.useStatItemStore.getState().positions,
          graphPositions: graphStore.useGraphItemStore.getState().positions,
          knobPositions: knobStore.useKnobItemStore.getState().positions,
          spritePositions: spriteStore.useSpriteStore.getState().positions,
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
    spritePositions: {},
    layerGroups: {},
  }),
}));

vi.mock('@src/renderer/editor/runtime/elementOps', () => ({
  setElementGroupsByTargets: mocks.setElementGroupsByTargets,
  setLayerGroupHidden: mocks.setLayerGroupHidden,
}));

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

import {
  setMixedElementGroups,
  setMixedLayerGroupHidden,
} from './mixedElementGroups';

const KEY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INSTANCE_ID = '10000000-0000-4000-8000-000000000001';
const FULL_ID = `plugin-a::${INSTANCE_ID}`;
const GROUP_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const pluginElement = (
  overrides: Partial<PluginDisplayElementInternal> = {},
): PluginDisplayElementInternal =>
  ({
    id: INSTANCE_ID,
    fullId: FULL_ID,
    pluginId: 'plugin-a',
    definitionId: 'plugin-a',
    position: { x: 1, y: 2 },
    tabId: '4key',
    zIndex: 0,
    ...overrides,
  } as never);

const seedStores = () => {
  const position = { ...createDefaultKeyPosition(), id: KEY_ID };
  useKeyStore.setState({
    keyMappings: { '4key': [''] },
    canonicalPositions: { '4key': [position] },
    positions: { '4key': [position] },
  } as never);
  useStatItemStore.setState({ positions: {} });
  useGraphItemStore.setState({ positions: {} });
  useKnobItemStore.setState({ positions: {} });
  useSpriteStore.setState({ positions: {} });
  useLayerGroupStore.setState({ layerGroups: {} });
  usePluginDisplayElementStore.setState({ elements: [pluginElement()] });
};

describe('setMixedElementGroups', () => {
  beforeEach(() => {
    mocks.gestureCommit.mockClear();
    mocks.editorCommit.mockClear();
    mocks.drainQueues.mockClear();
    mocks.drainQueues.mockResolvedValue(undefined);
    mocks.rotateSession.mockClear();
    mocks.setElementGroupsByTargets.mockClear();
    mocks.setLayerGroupHidden.mockClear();
    seedStores();
  });

  it('혼합 그룹화는 단일 gestureId 커밋에 op와 pluginChanges를 함께 싣는다', async () => {
    await expect(
      setMixedElementGroups(
        '4key',
        [{ elementType: 'key', id: KEY_ID }],
        [FULL_ID],
        { kind: 'create', id: GROUP_ID, name: 'Group 1' },
      ),
    ).resolves.toBe(true);

    expect(mocks.gestureCommit).toHaveBeenCalledTimes(1);
    const request = mocks.gestureCommit.mock.calls[0]?.[0] as unknown as {
      gestureId: string;
      editorOps: unknown[];
      pluginChanges: Array<{
        pluginId: string;
        instances: Array<{ instanceId?: string; groupId?: string }>;
      }>;
    };
    expect(request.gestureId).toEqual(expect.any(String));
    expect(request.editorOps).toEqual([
      {
        kind: 'setElementGroups',
        mode: '4key',
        targets: [{ elementType: 'key', id: KEY_ID }],
        targetGroup: { kind: 'create', id: GROUP_ID, name: 'Group 1' },
      },
    ]);
    expect(request.pluginChanges).toEqual([
      {
        pluginId: 'plugin-a',
        instances: [
          expect.objectContaining({
            instanceId: INSTANCE_ID,
            groupId: GROUP_ID,
          }),
        ],
      },
    ]);
    // eager: 세 저장소 모두 소속 반영
    expect(usePluginDisplayElementStore.getState().elements[0].groupId).toBe(
      GROUP_ID,
    );
    expect(useKeyStore.getState().canonicalPositions['4key'][0].groupId).toBe(
      GROUP_ID,
    );
    expect(useLayerGroupStore.getState().layerGroups['4key']).toEqual([
      { id: GROUP_ID, name: 'Group 1' },
    ]);
    expect(mocks.setElementGroupsByTargets).not.toHaveBeenCalled();
  });

  it('plugin-only 그룹 생성은 빈 native targets op로 def 생성을 싣는다', async () => {
    await expect(
      setMixedElementGroups('4key', [], [FULL_ID], {
        kind: 'create',
        id: GROUP_ID,
        name: 'Group 1',
      }),
    ).resolves.toBe(true);

    const request = mocks.gestureCommit.mock.calls[0]?.[0] as unknown as {
      editorOps: Array<{ targets: unknown[] }>;
      pluginChanges: Array<{
        instances: Array<{ groupId?: string }>;
      }>;
    };
    expect(request.editorOps[0].targets).toEqual([]);
    expect(request.pluginChanges[0].instances[0].groupId).toBe(GROUP_ID);
    // eager: 플러그인 멤버만으로도 그룹 def가 생존
    expect(useLayerGroupStore.getState().layerGroups['4key']).toEqual([
      { id: GROUP_ID, name: 'Group 1' },
    ]);
  });

  it('plugin ungroup은 소속 해제를 pluginChanges로 싣고 빈 그룹 def를 정리한다', async () => {
    useLayerGroupStore.setState({
      layerGroups: { '4key': [{ id: GROUP_ID, name: 'Group 1' }] },
    });
    usePluginDisplayElementStore.setState({
      elements: [pluginElement({ groupId: GROUP_ID })],
    });

    await expect(
      setMixedElementGroups('4key', [], [FULL_ID], null),
    ).resolves.toBe(true);

    const request = mocks.gestureCommit.mock.calls[0]?.[0] as unknown as {
      pluginChanges: Array<{ instances: Array<{ groupId?: string }> }>;
    };
    expect(request.pluginChanges[0].instances[0].groupId).toBeUndefined();
    expect(
      usePluginDisplayElementStore.getState().elements[0].groupId,
    ).toBeUndefined();
    // 마지막 멤버 해제 - eager normalize가 def를 정리
    expect(useLayerGroupStore.getState().layerGroups['4key'] ?? []).toEqual([]);
  });

  it('plugin 대상 소실은 fail-closed로 커밋하지 않는다', async () => {
    await expect(
      setMixedElementGroups('4key', [], ['plugin-a::missing'], {
        kind: 'create',
        id: GROUP_ID,
        name: 'Group 1',
      }),
    ).resolves.toBe(false);

    expect(mocks.gestureCommit).not.toHaveBeenCalled();
  });

  it('모드 밖 plugin 대상은 fail-closed로 커밋하지 않는다', async () => {
    usePluginDisplayElementStore.setState({
      elements: [pluginElement({ tabId: '7key' })],
    });

    await expect(
      setMixedElementGroups('4key', [], [FULL_ID], {
        kind: 'create',
        id: GROUP_ID,
        name: 'Group 1',
      }),
    ).resolves.toBe(false);

    expect(mocks.gestureCommit).not.toHaveBeenCalled();
  });

  it('편입 전 실패는 eager를 CAS로 복원한다', async () => {
    mocks.drainQueues.mockRejectedValueOnce(new Error('drain failed'));

    await expect(
      setMixedElementGroups(
        '4key',
        [{ elementType: 'key', id: KEY_ID }],
        [FULL_ID],
        { kind: 'create', id: GROUP_ID, name: 'Group 1' },
      ),
    ).rejects.toThrow('drain failed');

    expect(mocks.gestureCommit).not.toHaveBeenCalled();
    expect(
      usePluginDisplayElementStore.getState().elements[0].groupId,
    ).toBeUndefined();
    expect(
      useKeyStore.getState().canonicalPositions['4key'][0].groupId,
    ).toBeUndefined();
    expect(useLayerGroupStore.getState().layerGroups['4key']).toBeUndefined();
  });

  it('편입 전 실패라도 병행 편집된 groupId는 CAS가 보존한다', async () => {
    mocks.drainQueues.mockImplementationOnce(async () => {
      // eager 이후, 실패 이전의 병행 편집 재현
      const store = usePluginDisplayElementStore.getState();
      store.setElements([
        { ...store.elements[0], groupId: 'hijacked' } as never,
      ]);
      throw new Error('drain failed');
    });

    await expect(
      setMixedElementGroups(
        '4key',
        [{ elementType: 'key', id: KEY_ID }],
        [FULL_ID],
        { kind: 'create', id: GROUP_ID, name: 'Group 1' },
      ),
    ).rejects.toThrow('drain failed');

    // 우리가 쓴 값이 아니므로 복원하지 않는다
    expect(usePluginDisplayElementStore.getState().elements[0].groupId).toBe(
      'hijacked',
    );
  });
});

describe('setMixedLayerGroupHidden', () => {
  const seedMixedGroup = (
    overrides: {
      keyId?: string;
      pluginHidden?: boolean;
    } = {},
  ) => {
    const keyId = overrides.keyId ?? KEY_ID;
    const position = {
      ...createDefaultKeyPosition(),
      id: keyId,
      groupId: GROUP_ID,
    };
    useKeyStore.setState({
      keyMappings: { '4key': [''] },
      canonicalPositions: { '4key': [position] },
      positions: { '4key': [position] },
    } as never);
    useStatItemStore.setState({ positions: {} });
    useGraphItemStore.setState({ positions: {} });
    useKnobItemStore.setState({ positions: {} });
    useSpriteStore.setState({ positions: {} });
    useLayerGroupStore.setState({
      layerGroups: { '4key': [{ id: GROUP_ID, name: 'Group 1' }] },
    });
    usePluginDisplayElementStore.setState({
      elements: [
        pluginElement({ groupId: GROUP_ID, hidden: overrides.pluginHidden }),
      ],
    });
  };

  beforeEach(() => {
    mocks.gestureCommit.mockClear();
    mocks.drainQueues.mockClear();
    mocks.drainQueues.mockResolvedValue(undefined);
    mocks.rotateSession.mockClear();
    mocks.setLayerGroupHidden.mockClear();
    seedStores();
  });

  it('혼합 그룹 토글은 단일 gestureId 커밋에 patchElement op와 hidden pluginChanges를 함께 싣는다', async () => {
    seedMixedGroup();

    await expect(
      setMixedLayerGroupHidden('4key', GROUP_ID, true),
    ).resolves.toBe(true);

    expect(mocks.gestureCommit).toHaveBeenCalledTimes(1);
    const request = mocks.gestureCommit.mock.calls[0]?.[0] as unknown as {
      gestureId: string;
      editorOps: unknown[];
      pluginChanges: Array<{
        pluginId: string;
        instances: Array<{ instanceId?: string; hidden?: boolean }>;
      }>;
    };
    expect(request.gestureId).toEqual(expect.any(String));
    expect(request.editorOps).toEqual([
      {
        kind: 'patchElement',
        elementType: 'key',
        id: KEY_ID,
        patch: { property: 'hidden', value: true },
      },
    ]);
    expect(request.pluginChanges).toEqual([
      {
        pluginId: 'plugin-a',
        instances: [
          expect.objectContaining({ instanceId: INSTANCE_ID, hidden: true }),
        ],
      },
    ]);
    // eager: 양쪽 저장소 모두 hidden 반영
    expect(useKeyStore.getState().canonicalPositions['4key'][0].hidden).toBe(
      true,
    );
    expect(usePluginDisplayElementStore.getState().elements[0].hidden).toBe(
      true,
    );
    expect(mocks.setLayerGroupHidden).not.toHaveBeenCalled();
  });

  it('sprite+plugin 그룹 토글은 sprite를 patchElement 목록에 싣고 스토어에도 숨긴다', async () => {
    const SPRITE_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    useSpriteStore.setState({
      positions: {
        '4key': [
          {
            id: SPRITE_ID,
            dx: 0,
            dy: 0,
            width: 200,
            height: 120,
            hidden: false,
            zIndex: null,
            layerName: null,
            groupId: GROUP_ID,
            className: null,
            useInlineStyles: null,
            baseImage: null,
            imageFit: null,
            imageRect: { x: 0, y: 0, width: 100, height: 100 },
            pivot: { x: 0.5, y: 0.5 },
            idleTransform: { x: 0, y: 0, rotation: 0, scale: 1 },
            poses: [],
            transitionMs: 90,
            transitionEasing: 'linear',
          },
        ],
      },
    });
    useLayerGroupStore.setState({
      layerGroups: { '4key': [{ id: GROUP_ID, name: 'Group 1' }] },
    });
    usePluginDisplayElementStore.setState({
      elements: [pluginElement({ groupId: GROUP_ID })],
    });

    await expect(
      setMixedLayerGroupHidden('4key', GROUP_ID, true),
    ).resolves.toBe(true);

    expect(mocks.gestureCommit).toHaveBeenCalledTimes(1);
    const request = mocks.gestureCommit.mock.calls[0]?.[0] as unknown as {
      editorOps: unknown[];
      pluginChanges: Array<{
        pluginId: string;
        instances: Array<{ instanceId?: string; hidden?: boolean }>;
      }>;
    };
    expect(request.editorOps).toEqual([
      {
        kind: 'patchElement',
        elementType: 'sprite',
        id: SPRITE_ID,
        patch: { property: 'hidden', value: true },
      },
    ]);
    expect(request.pluginChanges).toEqual([
      {
        pluginId: 'plugin-a',
        instances: [
          expect.objectContaining({ instanceId: INSTANCE_ID, hidden: true }),
        ],
      },
    ]);
    // eager: sprite 스토어에도 즉시 숨김 반영
    expect(useSpriteStore.getState().positions['4key'][0].hidden).toBe(true);
    expect(usePluginDisplayElementStore.getState().elements[0].hidden).toBe(
      true,
    );
    expect(mocks.setLayerGroupHidden).not.toHaveBeenCalled();
  });

  it('플러그인 멤버가 없으면 기존 native 전용 경로에 위임한다', async () => {
    // seedStores 기본: 플러그인 무소속, key도 무소속
    await expect(
      setMixedLayerGroupHidden('4key', GROUP_ID, true),
    ).resolves.toBe(true);

    expect(mocks.setLayerGroupHidden).toHaveBeenCalledWith(
      '4key',
      GROUP_ID,
      true,
      {},
    );
    expect(mocks.gestureCommit).not.toHaveBeenCalled();
  });

  it('plugin-only 그룹도 단일 gesture 커밋으로 hidden을 저장한다', async () => {
    usePluginDisplayElementStore.setState({
      elements: [pluginElement({ groupId: GROUP_ID })],
    });
    useLayerGroupStore.setState({
      layerGroups: { '4key': [{ id: GROUP_ID, name: 'Group 1' }] },
    });

    await expect(
      setMixedLayerGroupHidden('4key', GROUP_ID, true),
    ).resolves.toBe(true);

    expect(usePluginDisplayElementStore.getState().elements[0].hidden).toBe(
      true,
    );
    expect(mocks.gestureCommit).toHaveBeenCalledTimes(1);
    const request = mocks.gestureCommit.mock.calls[0]?.[0] as unknown as {
      editorChanges?: unknown;
      editorOps?: unknown[];
      pluginChanges: Array<{
        pluginId: string;
        instances: Array<{ instanceId?: string; hidden?: boolean }>;
      }>;
    };
    expect(request.editorChanges).toBeUndefined();
    expect(request.editorOps).toBeUndefined();
    expect(request.pluginChanges).toEqual([
      {
        pluginId: 'plugin-a',
        instances: [
          expect.objectContaining({ instanceId: INSTANCE_ID, hidden: true }),
        ],
      },
    ]);
    expect(mocks.setLayerGroupHidden).not.toHaveBeenCalled();
  });

  it('plugin-only 그룹의 다중 플러그인 토글은 한 transaction에 함께 저장한다', async () => {
    const secondInstanceId = '20000000-0000-4000-8000-000000000002';
    usePluginDisplayElementStore.setState({
      elements: [
        pluginElement({ groupId: GROUP_ID }),
        pluginElement({
          id: secondInstanceId,
          fullId: `plugin-b::${secondInstanceId}`,
          pluginId: 'plugin-b',
          definitionId: 'plugin-b',
          groupId: GROUP_ID,
        }),
      ],
    });
    useLayerGroupStore.setState({
      layerGroups: { '4key': [{ id: GROUP_ID, name: 'Group 1' }] },
    });

    await expect(
      setMixedLayerGroupHidden('4key', GROUP_ID, true),
    ).resolves.toBe(true);

    expect(mocks.gestureCommit).toHaveBeenCalledTimes(1);
    const request = mocks.gestureCommit.mock.calls[0]?.[0] as unknown as {
      pluginChanges: Array<{
        pluginId: string;
        instances: Array<{ instanceId?: string; hidden?: boolean }>;
      }>;
    };
    expect(request.pluginChanges).toEqual([
      {
        pluginId: 'plugin-a',
        instances: [
          expect.objectContaining({ instanceId: INSTANCE_ID, hidden: true }),
        ],
      },
      {
        pluginId: 'plugin-b',
        instances: [
          expect.objectContaining({
            instanceId: secondInstanceId,
            hidden: true,
          }),
        ],
      },
    ]);
    expect(
      usePluginDisplayElementStore
        .getState()
        .elements.map(({ hidden }) => hidden),
    ).toEqual([true, true]);
  });

  it('canonical ID가 아닌 native 멤버가 섞이면 fail-closed로 중단한다', async () => {
    seedMixedGroup({ keyId: 'key-0' });

    await expect(
      setMixedLayerGroupHidden('4key', GROUP_ID, true),
    ).resolves.toBe(false);

    expect(mocks.gestureCommit).not.toHaveBeenCalled();
    expect(mocks.setLayerGroupHidden).not.toHaveBeenCalled();
    expect(
      usePluginDisplayElementStore.getState().elements[0].hidden,
    ).toBeUndefined();
  });

  it('편입 전 실패는 hidden eager를 CAS로 복원한다', async () => {
    seedMixedGroup();
    mocks.drainQueues.mockRejectedValueOnce(new Error('drain failed'));

    await expect(
      setMixedLayerGroupHidden('4key', GROUP_ID, true),
    ).rejects.toThrow('drain failed');

    expect(mocks.gestureCommit).not.toHaveBeenCalled();
    // 원래 값 복원 - 기본 position은 hidden: false
    expect(useKeyStore.getState().canonicalPositions['4key'][0].hidden).toBe(
      false,
    );
    expect(
      usePluginDisplayElementStore.getState().elements[0].hidden,
    ).toBeUndefined();
  });
});
