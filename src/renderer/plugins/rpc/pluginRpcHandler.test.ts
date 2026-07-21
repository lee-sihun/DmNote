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
  getPluginAuthorityGeneration: () => 7,
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
});
