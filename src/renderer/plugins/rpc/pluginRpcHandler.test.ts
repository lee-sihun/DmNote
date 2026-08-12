import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requestListener: undefined as
    | ((envelope: Record<string, unknown>) => void)
    | undefined,
  respond: vi.fn(
    (_targetWindowLabel: string, _response: Record<string, unknown>) =>
      Promise.resolve(),
  ),
  commit: vi.fn(),
  updateElement: vi.fn(),
  applyProjection: vi.fn((_pluginId: string, apply: () => void) => apply()),
  rotateEditSession: vi.fn((pluginId: string) => `gesture-${pluginId}`),
  flushPanelModel: vi.fn(),
  deleteFrozenSelection: vi.fn(() => Promise.resolve()),
  commitLayerDropIntent: vi.fn(() => Promise.resolve()),
  patchElementProperty: vi.fn(
    (
      _type?: unknown,
      _id?: unknown,
      _patch?: unknown,
      _options?: { preflight?: () => void },
    ) => Promise.resolve(true),
  ),
  patchGraphTypes: vi.fn(
    (
      _ids?: unknown,
      _graphType?: unknown,
      _options?: { preflight?: () => void },
    ) => Promise.resolve(true),
  ),
  authorityGeneration: 7,
  elements: [] as Array<Record<string, unknown>>,
}));

vi.mock('@api/modules/pluginRpcApi', () => ({
  PLUGIN_RPC_PROTOCOL_VERSION: 1,
  pluginRpcApi: {
    onRequest: (listener: (envelope: Record<string, unknown>) => void) => {
      mocks.requestListener = listener;
      return vi.fn();
    },
    respond: mocks.respond,
  },
}));

vi.mock('@api/modules/pluginInstancesApi', () => ({
  pluginInstancesApi: {
    commit: mocks.commit,
  },
}));

vi.mock('@stores/plugin/usePluginDisplayElementStore', () => ({
  usePluginDisplayElementStore: {
    getState: () => ({
      elements: mocks.elements,
      updateElement: mocks.updateElement,
    }),
  },
}));

vi.mock('@plugins/runtime/displayElement/instancesUndoSync', () => ({
  applyCommittedPluginInstancesProjection: mocks.applyProjection,
  notePluginInstancesMutation: vi.fn(),
}));

vi.mock('@plugins/runtime/displayElement/instancesCommitQueue', () => ({
  clearPluginInstancesEditSessions: vi.fn(),
  enqueuePluginInstancesCommit: (
    _pluginId: string,
    task: () => Promise<unknown>,
  ) => task(),
  rotatePluginInstancesEditSession: mocks.rotateEditSession,
  touchPluginInstancesEditSession: vi.fn(() => 'touched-gesture'),
}));

vi.mock('@plugins/runtime/displayElement/instanceLifecycle', () => ({
  normalizePluginInstanceTabId: (tabId?: string) => tabId ?? '4key',
}));

vi.mock('@stores/data/useHistoryStatusStore', () => ({
  useHistoryStatusStore: {
    getState: () => ({ historyEpoch: 3 }),
  },
  syncHistoryStatus: vi.fn(),
}));

vi.mock('@utils/plugin/panelModelSync', () => ({
  getPluginPanelModelRevision: () => 11,
  flushPluginPanelModelSyncNow: mocks.flushPanelModel,
}));

vi.mock('./pluginRpcClient', () => ({
  getPluginAuthorityGeneration: () => mocks.authorityGeneration,
}));

vi.mock('@src/renderer/editor/runtime/deleteFrozenSelection', () => ({
  deleteFrozenSelection: mocks.deleteFrozenSelection,
}));

vi.mock('@src/renderer/editor/runtime/elementOps', () => ({
  patchElementPropertyById: mocks.patchElementProperty,
  patchGraphTypesByIds: mocks.patchGraphTypes,
}));

vi.mock(
  '@components/main/Grid/PropertiesPanel/layer/layerReorderIntent',
  () => ({
    commitLayerDropIntent: mocks.commitLayerDropIntent,
  }),
);

vi.mock('@stores/data/useKeyStore', () => ({
  useKeyStore: {
    getState: () => ({ selectedKeyType: '4key' }),
  },
}));

vi.mock('./pluginModelRevision', () => ({
  noteBackendPluginRevision: vi.fn(),
}));

vi.mock('./pluginSettingsSession', () => ({
  handlePluginSettingsOperation: vi.fn(),
}));

const envelope = (
  operation: string,
  payload: Record<string, unknown>,
): Record<string, unknown> => ({
  protocolVersion: 1,
  requestId: crypto.randomUUID(),
  sourceWindowLabel: 'panel',
  authorityGeneration: 7,
  expectedModelRevision: 11,
  operation,
  payload,
});

const reorderAnchors = () => ({
  toDisplayIndex: 2,
  targetGroupId: null,
  anchorBeforeId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  anchorAfterId: null,
  anchorHeaderGroupId: null,
  anchorBeforeHeaderGroupId: null,
  anchorAfterHeaderGroupId: null,
  boundary: null,
});

describe('plugin panel persisted element mutations', () => {
  beforeEach(async () => {
    vi.resetModules();
    mocks.requestListener = undefined;
    mocks.respond.mockClear();
    mocks.commit.mockReset();
    mocks.updateElement.mockReset();
    mocks.applyProjection.mockClear();
    mocks.rotateEditSession.mockClear();
    mocks.flushPanelModel.mockClear();
    mocks.deleteFrozenSelection.mockReset();
    mocks.deleteFrozenSelection.mockResolvedValue(undefined);
    mocks.commitLayerDropIntent.mockReset();
    mocks.commitLayerDropIntent.mockResolvedValue(undefined);
    mocks.patchElementProperty.mockReset();
    mocks.patchElementProperty.mockResolvedValue(true);
    mocks.patchGraphTypes.mockReset();
    mocks.patchGraphTypes.mockResolvedValue(true);
    mocks.authorityGeneration = 7;
    mocks.elements = [
      {
        fullId: 'plugin-a:one',
        definitionId: 'plugin-a',
        pluginId: 'plugin-a',
        position: { x: 10, y: 20 },
        settings: { enabled: true },
        measuredSize: { width: 100, height: 80 },
        tabId: '4key',
        hidden: false,
        zIndex: 1,
      },
    ];
    mocks.updateElement.mockImplementation(
      (fullId: string, patch: Record<string, unknown>) => {
        mocks.elements = mocks.elements.map((element) =>
          element.fullId === fullId ? { ...element, ...patch } : element,
        );
      },
    );

    const { initPluginRpcHandler } = await import('./pluginRpcHandler');
    initPluginRpcHandler();
  });

  it.each([
    [
      'elements:setHidden',
      { targets: [{ fullId: 'plugin-a:one', hidden: true }] },
      { hidden: true },
    ],
    [
      'elements:setZIndexes',
      { entries: [{ fullId: 'plugin-a:one', zIndex: 9 }] },
      { zIndex: 9 },
    ],
  ])(
    '%s는 canonical commit 성공 뒤에만 projection한다',
    async (operation, payload, expectedPatch) => {
      let resolveCommit!: (value: Record<string, unknown>) => void;
      mocks.commit.mockReturnValue(
        new Promise((resolve) => {
          resolveCommit = resolve;
        }),
      );

      mocks.requestListener?.(envelope(operation, payload));

      await vi.waitFor(() => expect(mocks.commit).toHaveBeenCalledOnce());
      expect(mocks.updateElement).not.toHaveBeenCalled();
      expect(mocks.respond).not.toHaveBeenCalled();
      expect(mocks.rotateEditSession).toHaveBeenCalledWith('plugin-a');

      const request = mocks.commit.mock.calls[0]?.[0];
      expect(request).toMatchObject({
        pluginId: 'plugin-a',
        gestureId: 'gesture-plugin-a',
        instances: [
          {
            hidden: operation === 'elements:setHidden',
            zIndex: operation === 'elements:setZIndexes' ? 9 : 1,
          },
        ],
      });

      resolveCommit({ modelRevision: 12, changed: true });

      await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
      expect(mocks.applyProjection).toHaveBeenCalledOnce();
      expect(mocks.updateElement).toHaveBeenCalledWith(
        'plugin-a:one',
        expectedPatch,
      );
      expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({ ok: true });
    },
  );

  it.each([
    [
      'elements:setHidden',
      { targets: [{ fullId: 'plugin-a:one', hidden: true }] },
    ],
    [
      'elements:setZIndexes',
      { entries: [{ fullId: 'plugin-a:one', zIndex: 9 }] },
    ],
  ])(
    '%s commit 실패 시 projection을 적용하지 않는다',
    async (operation, payload) => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      mocks.commit.mockRejectedValue(new Error('disk failure'));

      mocks.requestListener?.(envelope(operation, payload));

      await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
      expect(mocks.applyProjection).not.toHaveBeenCalled();
      expect(mocks.updateElement).not.toHaveBeenCalled();
      expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
        ok: false,
        error: { code: 'INSTANCES_COMMIT_FAILED' },
      });
    },
  );

  it('유한한 32비트 정수가 아닌 zIndex를 commit 전에 거절한다', async () => {
    mocks.requestListener?.(
      envelope('elements:setZIndexes', {
        entries: [{ fullId: 'plugin-a:one', zIndex: Number.NaN }],
      }),
    );

    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(mocks.updateElement).not.toHaveBeenCalled();
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'INVALID_PAYLOAD' },
    });
  });

  it('레이어 삭제는 stable descriptor만 공용 main 실행기에 전달한다', async () => {
    mocks.requestListener?.(
      envelope('layers:deleteSelection', {
        targets: [
          {
            elementType: 'key',
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          },
          { elementType: 'plugin', id: 'plugin-a:one' },
        ],
      }),
    );

    await vi.waitFor(() =>
      expect(mocks.deleteFrozenSelection).toHaveBeenCalledOnce(),
    );
    expect(mocks.deleteFrozenSelection).toHaveBeenCalledWith(
      [
        {
          type: 'key',
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
        { type: 'plugin', id: 'plugin-a:one' },
      ],
      '4key',
      {
        expectedAuthorityGeneration: 7,
        propagateErrors: true,
      },
    );
    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.flushPanelModel).toHaveBeenCalledOnce();
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({ ok: true });
  });

  it.each([
    ['top-level extra', { targets: [], changes: {} }],
    ['empty targets', { targets: [] }],
    [
      'target extra',
      {
        targets: [
          {
            elementType: 'plugin',
            id: 'plugin-a:one',
            index: 0,
          },
        ],
      },
    ],
    ['empty id', { targets: [{ elementType: 'plugin', id: ' ' }] }],
    ['synthetic native id', { targets: [{ elementType: 'key', id: 'key-0' }] }],
    [
      'duplicate id',
      {
        targets: [
          { elementType: 'plugin', id: 'plugin-a:one' },
          { elementType: 'plugin', id: 'plugin-a:one' },
        ],
      },
    ],
    [
      'unknown type',
      { targets: [{ elementType: 'layer', id: 'plugin-a:one' }] },
    ],
    [
      'too many targets',
      {
        targets: Array.from({ length: 4097 }, (_, index) => ({
          elementType: 'plugin',
          id: `plugin-a:${index}`,
        })),
      },
    ],
  ])('%s payload를 실행 전에 거절한다', async (_label, payload) => {
    mocks.requestListener?.(
      envelope('layers:deleteSelection', payload as Record<string, unknown>),
    );

    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.deleteFrozenSelection).not.toHaveBeenCalled();
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'INVALID_PAYLOAD' },
    });
  });

  it('레이어 삭제 완료 전에 generation이 바뀌면 성공으로 응답하지 않는다', async () => {
    let finish!: () => void;
    mocks.deleteFrozenSelection.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    mocks.requestListener?.(
      envelope('layers:deleteSelection', {
        targets: [{ elementType: 'plugin', id: 'plugin-a:one' }],
      }),
    );
    await vi.waitFor(() =>
      expect(mocks.deleteFrozenSelection).toHaveBeenCalledOnce(),
    );

    mocks.authorityGeneration = 8;
    finish();

    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.flushPanelModel).not.toHaveBeenCalled();
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'AUTHORITY_GENERATION_STALE' },
    });
  });

  it('낡은 generation의 레이어 삭제는 main 실행기를 시작하지 않는다', async () => {
    mocks.authorityGeneration = 8;
    mocks.requestListener?.(
      envelope('layers:deleteSelection', {
        targets: [{ elementType: 'plugin', id: 'plugin-a:one' }],
      }),
    );

    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.deleteFrozenSelection).not.toHaveBeenCalled();
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'AUTHORITY_GENERATION_STALE' },
    });
  });

  it.each([
    ['가시성', { hidden: true }],
    ['이름', { layerName: 'renamed' }],
    ['이름 clear', { layerName: null }],
    ['그래프 타입', { graphType: 'bar' }],
  ])(
    'native %s exact literal을 main semantic executor에 전달한다',
    async (_label, patch) => {
      mocks.requestListener?.(
        envelope('layers:patchProperty', {
          target: {
            elementType: 'graph',
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            patch,
          },
        }),
      );

      await vi.waitFor(() =>
        expect(mocks.patchElementProperty).toHaveBeenCalledOnce(),
      );
      expect(mocks.patchElementProperty).toHaveBeenCalledWith(
        'graph',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        patch,
        { preflight: expect.any(Function) },
      );
      await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
      expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({ ok: true });
    },
  );

  it('graphType batch는 ordered stable IDs를 semantic batch executor에 한 번 전달한다', async () => {
    mocks.requestListener?.(
      envelope('layers:patchProperty', {
        targets: [
          {
            elementType: 'graph',
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          },
          {
            elementType: 'graph',
            id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          },
        ],
        patch: { graphType: 'line' },
      }),
    );

    await vi.waitFor(() =>
      expect(mocks.patchGraphTypes).toHaveBeenCalledOnce(),
    );
    expect(mocks.patchGraphTypes).toHaveBeenCalledWith(
      [
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      ],
      'line',
      { preflight: expect.any(Function) },
    );
    expect(mocks.patchElementProperty).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({ ok: true });
  });

  it.each([
    [
      'top-level extra',
      {
        target: { elementType: 'key', id: 'stable', patch: { hidden: true } },
        extra: 1,
      },
    ],
    [
      'target extra',
      {
        target: {
          elementType: 'key',
          id: 'stable',
          patch: { hidden: true },
          index: 0,
        },
      },
    ],
    [
      'plugin type',
      {
        target: {
          elementType: 'plugin',
          id: 'plugin-a:one',
          patch: { hidden: true },
        },
      },
    ],
    [
      'synthetic native',
      {
        target: {
          elementType: 'key',
          id: 'key-0',
          patch: { hidden: true },
        },
      },
    ],
    [
      'empty id',
      {
        target: {
          elementType: 'stat',
          id: ' ',
          patch: { hidden: true },
        },
      },
    ],
    ['missing patch', { target: { elementType: 'knob', id: 'stable' } }],
    [
      'both leaves',
      {
        target: {
          elementType: 'knob',
          id: 'stable',
          patch: { hidden: true, layerName: 'name' },
        },
      },
    ],
    [
      'patch extra',
      {
        target: {
          elementType: 'knob',
          id: 'stable',
          patch: { layerName: null, extra: true },
        },
      },
    ],
    [
      'invalid leaf',
      {
        target: {
          elementType: 'knob',
          id: 'stable',
          patch: { hidden: 1 },
        },
      },
    ],
    ['empty batch', { targets: [], patch: { graphType: 'bar' } }],
    [
      'oversized batch',
      {
        targets: Array.from({ length: 4097 }, (_, index) => ({
          elementType: 'graph',
          id: `stable-${index}`,
        })),
        patch: { graphType: 'bar' },
      },
    ],
    [
      'duplicate batch id',
      {
        targets: [
          { elementType: 'graph', id: 'stable' },
          { elementType: 'graph', id: 'stable' },
        ],
        patch: { graphType: 'bar' },
      },
    ],
    [
      'batch wrong type',
      {
        targets: [{ elementType: 'stat', id: 'stable' }],
        patch: { graphType: 'bar' },
      },
    ],
    [
      'single graph leaf wrong type',
      {
        target: {
          elementType: 'knob',
          id: 'stable',
          patch: { graphType: 'bar' },
        },
      },
    ],
    [
      'batch non-graph leaf',
      {
        targets: [{ elementType: 'graph', id: 'stable' }],
        patch: { hidden: true },
      },
    ],
    [
      'single and batch together',
      {
        target: {
          elementType: 'graph',
          id: 'single',
          patch: { graphType: 'bar' },
        },
        targets: [{ elementType: 'graph', id: 'batch' }],
        patch: { graphType: 'bar' },
      },
    ],
  ])(
    '%s native property payload를 실행 전에 거절한다',
    async (_label, payload) => {
      mocks.requestListener?.(envelope('layers:patchProperty', payload));

      await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
      expect(mocks.patchElementProperty).not.toHaveBeenCalled();
      expect(mocks.patchGraphTypes).not.toHaveBeenCalled();
      expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
        ok: false,
        error: { code: 'INVALID_PAYLOAD' },
      });
    },
  );

  it('native property 완료 전에 generation이 바뀌면 성공으로 응답하지 않는다', async () => {
    let finish!: () => void;
    mocks.patchElementProperty.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        finish = () => resolve(true);
      }),
    );
    mocks.requestListener?.(
      envelope('layers:patchProperty', {
        target: {
          elementType: 'key',
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          patch: { layerName: null },
        },
      }),
    );
    await vi.waitFor(() =>
      expect(mocks.patchElementProperty).toHaveBeenCalledOnce(),
    );

    mocks.authorityGeneration = 8;
    finish();

    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'AUTHORITY_GENERATION_STALE' },
    });
  });

  it('native property는 main 직렬 슬롯 진입 전에 generation을 다시 검사한다', async () => {
    mocks.patchElementProperty.mockImplementationOnce(
      async (_type, _id, _patch, options) => {
        mocks.authorityGeneration = 8;
        options?.preflight?.();
        return true;
      },
    );
    mocks.requestListener?.(
      envelope('layers:patchProperty', {
        target: {
          elementType: 'key',
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          patch: { hidden: true },
        },
      }),
    );

    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'AUTHORITY_GENERATION_STALE' },
    });
  });

  it('레이어 재정렬은 exact descriptor를 main executor에 전달한다', async () => {
    mocks.requestListener?.(
      envelope('layers:reorderSelection', {
        descriptor: {
          kind: 'items',
          mode: '4key',
          draggedIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
          collapsedGroupIds: ['panel-collapsed'],
          anchors: reorderAnchors(),
          preserveFullGroups: false,
        },
      }),
    );

    await vi.waitFor(() =>
      expect(mocks.commitLayerDropIntent).toHaveBeenCalledOnce(),
    );
    expect(mocks.commitLayerDropIntent).toHaveBeenCalledWith(
      {
        kind: 'items',
        mode: '4key',
        draggedIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
        collapsedGroupIds: ['panel-collapsed'],
        anchors: {
          toDisplayIndex: 2,
          targetGroupId: undefined,
          anchorBeforeId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          anchorAfterId: null,
          anchorHeaderGroupId: null,
          anchorBeforeHeaderGroupId: null,
          anchorAfterHeaderGroupId: null,
          boundary: undefined,
        },
        preserveFullGroups: false,
      },
      { expectedAuthorityGeneration: 7 },
    );
    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({ ok: true });
  });

  it.each([
    [
      'top-level extra',
      {
        descriptor: {
          kind: 'items',
          mode: '4key',
          draggedIds: ['stable-id'],
          collapsedGroupIds: [],
          anchors: reorderAnchors(),
          preserveFullGroups: false,
        },
        ops: [],
      },
    ],
    [
      'descriptor extra',
      {
        descriptor: {
          kind: 'items',
          mode: '4key',
          draggedIds: ['stable-id'],
          collapsedGroupIds: [],
          anchors: reorderAnchors(),
          preserveFullGroups: false,
          index: 0,
        },
      },
    ],
    [
      'anchor missing',
      {
        descriptor: {
          kind: 'items',
          mode: '4key',
          draggedIds: ['stable-id'],
          collapsedGroupIds: [],
          anchors: { ...reorderAnchors(), boundary: undefined },
          preserveFullGroups: false,
        },
      },
    ],
    [
      'duplicate ids',
      {
        descriptor: {
          kind: 'items',
          mode: '4key',
          draggedIds: ['stable-id', 'stable-id'],
          collapsedGroupIds: [],
          anchors: reorderAnchors(),
          preserveFullGroups: false,
        },
      },
    ],
    [
      'empty items',
      {
        descriptor: {
          kind: 'items',
          mode: '4key',
          draggedIds: [],
          collapsedGroupIds: [],
          anchors: reorderAnchors(),
          preserveFullGroups: false,
        },
      },
    ],
    [
      'invalid group',
      {
        descriptor: {
          kind: 'group',
          mode: '4key',
          groupId: '',
          extraIds: [],
          collapsedGroupIds: [],
          anchors: reorderAnchors(),
        },
      },
    ],
  ])('%s 재정렬 payload를 main 실행 전에 거절한다', async (_label, payload) => {
    mocks.requestListener?.(
      envelope('layers:reorderSelection', payload as Record<string, unknown>),
    );

    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.commitLayerDropIntent).not.toHaveBeenCalled();
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'INVALID_PAYLOAD' },
    });
  });

  it('레이어 재정렬 완료 전 generation 변경은 성공으로 응답하지 않는다', async () => {
    let finish!: () => void;
    mocks.commitLayerDropIntent.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    mocks.requestListener?.(
      envelope('layers:reorderSelection', {
        descriptor: {
          kind: 'group',
          mode: '4key',
          groupId: 'group-a',
          extraIds: [],
          collapsedGroupIds: [],
          anchors: reorderAnchors(),
        },
      }),
    );
    await vi.waitFor(() =>
      expect(mocks.commitLayerDropIntent).toHaveBeenCalledOnce(),
    );
    mocks.authorityGeneration = 8;
    finish();

    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.flushPanelModel).not.toHaveBeenCalled();
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'AUTHORITY_GENERATION_STALE' },
    });
  });
});
