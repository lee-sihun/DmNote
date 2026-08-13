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
  commitElementGeometry: vi.fn(
    (
      _type?: unknown,
      _id?: unknown,
      _patch?: unknown,
      _options?: { preflight?: () => void },
    ) => Promise.resolve(true),
  ),
  commitBatchGeometry: vi.fn(
    (_descriptor?: unknown, _options?: { preflight?: () => void }) =>
      Promise.resolve(true),
  ),
  setLayerGroupHidden: vi.fn(
    (
      _mode?: unknown,
      _groupId?: unknown,
      _hidden?: unknown,
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
  patchGraphColors: vi.fn(
    (
      _ids?: unknown,
      _graphColor?: unknown,
      _options?: { preflight?: () => void },
    ) => Promise.resolve(true),
  ),
  patchGraphProperties: vi.fn(
    (_ids?: unknown, _patch?: unknown, _options?: { preflight?: () => void }) =>
      Promise.resolve(true),
  ),
  patchKnobProperties: vi.fn(
    (_ids?: unknown, _patch?: unknown, _options?: { preflight?: () => void }) =>
      Promise.resolve(true),
  ),
  patchUseInlineStyles: vi.fn(
    (
      _targets?: unknown,
      _useInlineStyles?: unknown,
      _options?: { preflight?: () => void },
    ) => Promise.resolve(true),
  ),
  patchFontStyle: vi.fn(
    (
      _targets?: unknown,
      _patch?: unknown,
      _options?: { preflight?: () => void },
    ) => Promise.resolve(true),
  ),
  patchFontFamily: vi.fn(
    (
      _targets?: unknown,
      _patch?: unknown,
      _options?: { preflight?: () => void },
    ) => Promise.resolve(true),
  ),
  patchDisplayText: vi.fn(
    (
      _targets?: unknown,
      _displayText?: unknown,
      _options?: { gestureId?: string; preflight?: () => void },
    ) => Promise.resolve(true),
  ),
  patchNoteProperties: vi.fn(
    (_ids?: unknown, _patch?: unknown, _options?: { preflight?: () => void }) =>
      Promise.resolve(true),
  ),
  patchInactiveImage: vi.fn(
    (
      _targets?: unknown,
      _inactiveImage?: unknown,
      _options?: { preflight?: () => void },
    ) => Promise.resolve(true),
  ),
  patchActiveImage: vi.fn(
    (
      _targets?: unknown,
      _activeImage?: unknown,
      _options?: { preflight?: () => void },
    ) => Promise.resolve(true),
  ),
  patchIdleTransparent: vi.fn(
    (
      _targets?: unknown,
      _idleTransparent?: unknown,
      _options?: { preflight?: () => void },
    ) => Promise.resolve(true),
  ),
  patchActiveTransparent: vi.fn(
    (
      _targets?: unknown,
      _activeTransparent?: unknown,
      _options?: { preflight?: () => void },
    ) => Promise.resolve(true),
  ),
  patchSoundPath: vi.fn(
    (
      _ids?: unknown,
      _soundPath?: unknown,
      _options?: { preflight?: () => void },
    ) => Promise.resolve(true),
  ),
  patchSoundEnabled: vi.fn(
    (
      _ids?: unknown,
      _soundEnabled?: unknown,
      _options?: { preflight?: () => void },
    ) => Promise.resolve(true),
  ),
  patchSoundVolume: vi.fn(
    (
      _ids?: unknown,
      _soundVolume?: unknown,
      _options?: { gestureId?: string; preflight?: () => void },
    ) => Promise.resolve(true),
  ),
  patchCounterAnimationPreset: vi.fn(
    (
      _targets?: unknown,
      _intent?: unknown,
      _options?: { preflight?: () => void },
    ) => Promise.resolve(true),
  ),
  patchCounterEnabled: vi.fn(
    (
      _targets?: unknown,
      _enabled?: unknown,
      _options?: { preflight?: () => void },
    ) => Promise.resolve(true),
  ),
  patchCounterAnimationEnabled: vi.fn(
    (
      _targets?: unknown,
      _enabled?: unknown,
      _options?: { preflight?: () => void },
    ) => Promise.resolve(true),
  ),
  patchCounterLayout: vi.fn(
    (
      _targets?: unknown,
      _patch?: unknown,
      _options?: { preflight?: () => void },
    ) => Promise.resolve(true),
  ),
  patchCounterTypography: vi.fn(
    (
      _targets?: unknown,
      _patch?: unknown,
      _options?: { preflight?: () => void },
    ) => Promise.resolve(true),
  ),
  patchCounterStroke: vi.fn(
    (
      _targets?: unknown,
      _patch?: unknown,
      _options?: { preflight?: () => void },
    ) => Promise.resolve(true),
  ),
  patchCounterFill: vi.fn(
    (
      _targets?: unknown,
      _patch?: unknown,
      _options?: { preflight?: () => void },
    ) => Promise.resolve(true),
  ),
  patchPaint: vi.fn(
    (
      _targets?: unknown,
      _patch?: unknown,
      _options?: { preflight?: () => void },
    ) => Promise.resolve(true),
  ),
  patchShadow: vi.fn(
    (
      _targets?: unknown,
      _patch?: unknown,
      _options?: { preflight?: () => void },
    ) => Promise.resolve(true),
  ),
  patchNotePaint: vi.fn(
    (
      _ids?: unknown,
      _patch?: unknown,
      _options?: { gestureId?: string; preflight?: () => void },
    ) => Promise.resolve(true),
  ),
  updateCounterAnimation: vi.fn(
    (_request?: unknown, _options?: unknown): Promise<unknown> =>
      Promise.resolve(null),
  ),
  deleteCounterAnimation: vi.fn(
    (_id?: unknown, _options?: unknown): Promise<unknown> =>
      Promise.resolve(null),
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
  commitBatchGeometryByIds: mocks.commitBatchGeometry,
  commitElementGeometryById: mocks.commitElementGeometry,
  patchElementPropertyById: mocks.patchElementProperty,
  patchGraphColorsByIds: mocks.patchGraphColors,
  patchFontStyleByTargets: mocks.patchFontStyle,
  patchFontFamilyByTargets: mocks.patchFontFamily,
  patchStylePropertyByTargets: mocks.patchDisplayText,
  patchInactiveImageByTargets: mocks.patchInactiveImage,
  patchActiveImageByTargets: mocks.patchActiveImage,
  patchIdleTransparentByTargets: mocks.patchIdleTransparent,
  patchActiveTransparentByTargets: mocks.patchActiveTransparent,
  patchSoundPathByIds: mocks.patchSoundPath,
  patchSoundEnabledByIds: mocks.patchSoundEnabled,
  patchSoundVolumeByIds: mocks.patchSoundVolume,
  patchCounterAnimationPresetByTargets: mocks.patchCounterAnimationPreset,
  patchCounterEnabledByTargets: mocks.patchCounterEnabled,
  patchCounterAnimationEnabledByTargets: mocks.patchCounterAnimationEnabled,
  patchCounterLayoutByTargets: mocks.patchCounterLayout,
  patchCounterTypographyByTargets: mocks.patchCounterTypography,
  patchCounterStrokeByTargets: mocks.patchCounterStroke,
  patchCounterFillByTargets: mocks.patchCounterFill,
  patchPaintByTargets: mocks.patchPaint,
  patchShadowByTargets: mocks.patchShadow,
  patchNotePaintByIds: mocks.patchNotePaint,
  patchGraphPropertiesByIds: mocks.patchGraphProperties,
  patchGraphTypesByIds: mocks.patchGraphTypes,
  patchKnobPropertiesByIds: mocks.patchKnobProperties,
  patchNotePropertiesByIds: mocks.patchNoteProperties,
  patchUseInlineStylesByTargets: mocks.patchUseInlineStyles,
  setLayerGroupHidden: mocks.setLayerGroupHidden,
}));

vi.mock('@api/modules/resourceApi', () => ({
  counterAnimationApi: {
    update: mocks.updateCounterAnimation,
    remove: mocks.deleteCounterAnimation,
  },
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
    mocks.commitElementGeometry.mockReset();
    mocks.commitElementGeometry.mockResolvedValue(true);
    mocks.commitBatchGeometry.mockReset();
    mocks.commitBatchGeometry.mockResolvedValue(true);
    mocks.setLayerGroupHidden.mockReset();
    mocks.setLayerGroupHidden.mockResolvedValue(true);
    mocks.patchGraphTypes.mockReset();
    mocks.patchGraphTypes.mockResolvedValue(true);
    mocks.patchGraphColors.mockReset();
    mocks.patchGraphColors.mockResolvedValue(true);
    mocks.patchGraphProperties.mockReset();
    mocks.patchGraphProperties.mockResolvedValue(true);
    mocks.patchKnobProperties.mockReset();
    mocks.patchKnobProperties.mockResolvedValue(true);
    mocks.patchUseInlineStyles.mockReset();
    mocks.patchUseInlineStyles.mockResolvedValue(true);
    mocks.patchFontStyle.mockReset();
    mocks.patchFontStyle.mockResolvedValue(true);
    mocks.patchFontFamily.mockReset();
    mocks.patchFontFamily.mockResolvedValue(true);
    mocks.patchDisplayText.mockReset();
    mocks.patchDisplayText.mockResolvedValue(true);
    mocks.patchInactiveImage.mockReset();
    mocks.patchInactiveImage.mockResolvedValue(true);
    mocks.patchActiveImage.mockReset();
    mocks.patchActiveImage.mockResolvedValue(true);
    mocks.patchIdleTransparent.mockReset();
    mocks.patchIdleTransparent.mockResolvedValue(true);
    mocks.patchActiveTransparent.mockReset();
    mocks.patchActiveTransparent.mockResolvedValue(true);
    mocks.patchSoundPath.mockReset();
    mocks.patchSoundPath.mockResolvedValue(true);
    mocks.patchSoundEnabled.mockReset();
    mocks.patchSoundEnabled.mockResolvedValue(true);
    mocks.patchSoundVolume.mockReset();
    mocks.patchSoundVolume.mockResolvedValue(true);
    mocks.patchCounterAnimationPreset.mockReset();
    mocks.patchCounterAnimationPreset.mockResolvedValue(true);
    mocks.patchCounterEnabled.mockReset();
    mocks.patchCounterEnabled.mockResolvedValue(true);
    mocks.patchCounterAnimationEnabled.mockReset();
    mocks.patchCounterAnimationEnabled.mockResolvedValue(true);
    mocks.patchCounterLayout.mockReset();
    mocks.patchCounterLayout.mockResolvedValue(true);
    mocks.patchCounterTypography.mockReset();
    mocks.patchCounterTypography.mockResolvedValue(true);
    mocks.patchCounterStroke.mockReset();
    mocks.patchCounterStroke.mockResolvedValue(true);
    mocks.patchCounterFill.mockReset();
    mocks.patchCounterFill.mockResolvedValue(true);
    mocks.patchPaint.mockReset();
    mocks.patchPaint.mockResolvedValue(true);
    mocks.patchShadow.mockReset();
    mocks.patchShadow.mockResolvedValue(true);
    mocks.patchNotePaint.mockReset();
    mocks.patchNotePaint.mockResolvedValue(true);
    mocks.updateCounterAnimation.mockReset();
    mocks.updateCounterAnimation.mockResolvedValue({
      preset: { id: 'preset-a' },
      affectedUsageCount: 2,
    });
    mocks.deleteCounterAnimation.mockReset();
    mocks.deleteCounterAnimation.mockResolvedValue({
      success: true,
      id: 'preset-a',
      affectedUsageCount: 2,
      fallbackPresetId: 'builtin-ease-out',
    });
    mocks.patchNoteProperties.mockReset();
    mocks.patchNoteProperties.mockResolvedValue(true);
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

  it('shadow batch는 exact one-leaf와 slot preflight를 전용 helper에 전달한다', async () => {
    const targets = [
      { elementType: 'key', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      { elementType: 'stat', id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    ];
    const patch = { shadow: { color: '  raw shadow  ' } };
    mocks.requestListener?.(
      envelope('layers:patchProperty', { targets, patch }),
    );
    await vi.waitFor(() => expect(mocks.patchShadow).toHaveBeenCalledOnce());
    expect(mocks.patchShadow).toHaveBeenCalledWith(targets, patch, {
      preflight: expect.any(Function),
    });
    expect(mocks.patchElementProperty).not.toHaveBeenCalled();
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({ ok: true });
  });

  it('shadow single은 exact target과 slot preflight를 전용 helper에 전달한다', async () => {
    const target = {
      elementType: 'knob',
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      patch: { activeShadow: { blur: 22.5 } },
    };
    mocks.requestListener?.(envelope('layers:patchProperty', { target }));
    await vi.waitFor(() => expect(mocks.patchShadow).toHaveBeenCalledOnce());
    expect(mocks.patchShadow).toHaveBeenCalledWith(
      [{ elementType: target.elementType, id: target.id }],
      target.patch,
      { preflight: expect.any(Function) },
    );
    expect(mocks.patchElementProperty).not.toHaveBeenCalled();
  });

  it('shadow single은 slot 직전 generation 변경을 거절한다', async () => {
    mocks.patchShadow.mockImplementationOnce(
      async (_targets, _patch, options) => {
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
          patch: { shadowEnabled: false },
        },
      }),
    );
    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'AUTHORITY_GENERATION_STALE' },
    });
    expect(mocks.patchElementProperty).not.toHaveBeenCalled();
  });

  it.each([
    [
      'graph',
      {
        targets: [{ elementType: 'graph', id: 'stable' }],
        patch: { shadow: { blur: 1 } },
      },
    ],
    [
      'active stat',
      {
        targets: [{ elementType: 'stat', id: 'stable' }],
        patch: { activeShadow: { blur: 1 } },
      },
    ],
    [
      'empty color',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { shadow: { color: '' } },
      },
    ],
    [
      'range',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { shadow: { offsetX: 101 } },
      },
    ],
    [
      'combined inner',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { shadow: { blur: 1, color: '#000' } },
      },
    ],
    [
      'combined outer',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { shadow: { blur: 1 }, shadowEnabled: true },
      },
    ],
  ])(
    'shadow invalid %s는 executor를 호출하지 않는다',
    async (_label, payload) => {
      mocks.requestListener?.(envelope('layers:patchProperty', payload));
      await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
      expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
        ok: false,
        error: { code: 'INVALID_PAYLOAD' },
      });
      expect(mocks.patchShadow).not.toHaveBeenCalled();
      expect(mocks.patchElementProperty).not.toHaveBeenCalled();
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
    expect(mocks.patchElementProperty).not.toHaveBeenCalled();
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
    ['가시성', { hidden: true }, 'graph'],
    ['이름', { layerName: 'renamed' }],
    ['이름 clear', { layerName: null }],
    ['그래프 타입', { graphType: 'bar' }],
    ['그래프 색상', { graphColor: '#12abEF' }],
    ['평균선', { showAvgLine: false }],
    ['그래프 애니메이션', { graphAnimationEnabled: true }],
    ['그래프 속도', { graphSpeed: 1200 }],
    ['노브 축', { axisId: '  HIDA:raw  ' }, 'knob'],
    ['사운드', { soundPath: '  sounds/raw.wav  ' }, 'key'],
    ['인라인 스타일', { useInlineStyles: true }],
    ['글꼴 굵기', { fontWeight: 700 }],
    ['글꼴 기울임', { fontItalic: true }],
    ['글꼴 밑줄', { fontUnderline: false }],
    ['글꼴 취소선', { fontStrikethrough: true }],
    ['글꼴 패밀리', { fontFamily: '  Raw Family  ' }],
    ['대기 이미지', { inactiveImage: '  Raw Image.png  ' }],
    ['활성 이미지', { activeImage: '  Raw Active.png  ' }, 'key'],
    ['대기 투명', { idleTransparent: true }],
    ['활성 투명', { activeTransparent: false }, 'knob'],
    ['대기 이미지 맞춤', { idleImageFit: 'contain' }],
    ['활성 이미지 맞춤', { activeImageFit: 'fill' }, 'key'],
    ['노트 효과', { noteEffectEnabled: false }, 'key'],
    ['노트 Y 보정', { noteAutoYCorrection: true }, 'key'],
    ['노트 글로우', { noteGlowEnabled: false }, 'key'],
    ['노트 정렬', { noteAlignment: 'right' }, 'key'],
    ['노트 테두리 방향', { noteBorderSide: 'horizontal' }, 'key'],
  ])(
    'native %s exact literal을 main semantic executor에 전달한다',
    async (_label, patch, elementType = 'graph') => {
      mocks.requestListener?.(
        envelope('layers:patchProperty', {
          target: {
            elementType,
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            patch,
          },
        }),
      );

      await vi.waitFor(() =>
        expect(mocks.patchElementProperty).toHaveBeenCalledOnce(),
      );
      expect(mocks.patchElementProperty).toHaveBeenCalledWith(
        elementType,
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        patch,
        { preflight: expect.any(Function) },
      );
      await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
      expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({ ok: true });
    },
  );

  it('인라인 스타일 batch는 혼합 native 대상을 ordered semantic commit 하나로 전달한다', async () => {
    const targets = [
      {
        elementType: 'key',
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      {
        elementType: 'stat',
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      },
      {
        elementType: 'graph',
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      },
      {
        elementType: 'knob',
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      },
    ] as const;
    mocks.requestListener?.(
      envelope('layers:patchProperty', {
        targets,
        patch: { useInlineStyles: false },
      }),
    );

    await vi.waitFor(() =>
      expect(mocks.patchUseInlineStyles).toHaveBeenCalledOnce(),
    );
    expect(mocks.patchUseInlineStyles).toHaveBeenCalledWith(targets, false, {
      preflight: expect.any(Function),
    });
    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({ ok: true });
  });

  it.each([
    [{ fontWeight: 700 }],
    [{ fontItalic: true }],
    [{ fontUnderline: false }],
    [{ fontStrikethrough: true }],
  ] as const)(
    'font style batch %j는 혼합 native 대상을 ordered semantic commit 하나로 전달한다',
    async (patch) => {
      const targets = [
        {
          elementType: 'key',
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
        {
          elementType: 'stat',
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        },
        {
          elementType: 'graph',
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        },
        {
          elementType: 'knob',
          id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        },
      ] as const;
      mocks.requestListener?.(
        envelope('layers:patchProperty', { targets, patch }),
      );

      await vi.waitFor(() =>
        expect(mocks.patchFontStyle).toHaveBeenCalledOnce(),
      );
      expect(mocks.patchFontStyle).toHaveBeenCalledWith(targets, patch, {
        preflight: expect.any(Function),
      });
      await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
      expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({ ok: true });
    },
  );

  it('fontFamily batch는 혼합 native 대상을 ordered semantic commit 하나로 전달한다', async () => {
    const targets = [
      {
        elementType: 'key',
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      {
        elementType: 'stat',
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      },
      {
        elementType: 'graph',
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      },
      {
        elementType: 'knob',
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      },
    ] as const;
    const patch = { fontFamily: '  Raw Family  ' } as const;
    mocks.requestListener?.(
      envelope('layers:patchProperty', { targets, patch }),
    );

    await vi.waitFor(() =>
      expect(mocks.patchFontFamily).toHaveBeenCalledOnce(),
    );
    expect(mocks.patchFontFamily).toHaveBeenCalledWith(targets, patch, {
      preflight: expect.any(Function),
    });
    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({ ok: true });
  });

  it('displayText batch는 common targets와 gesture를 한 semantic commit으로 전달한다', async () => {
    const targets = [
      {
        elementType: 'key',
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      {
        elementType: 'graph',
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      },
    ] as const;
    const gestureId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    mocks.requestListener?.(
      envelope('layers:patchProperty', {
        targets,
        patch: { displayText: '  Raw label  ' },
        gestureId,
      }),
    );

    await vi.waitFor(() =>
      expect(mocks.patchDisplayText).toHaveBeenCalledOnce(),
    );
    expect(mocks.patchDisplayText).toHaveBeenCalledWith(
      targets,
      { displayText: '  Raw label  ' },
      {
        gestureId,
        preflight: expect.any(Function),
      },
    );
    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({ ok: true });
  });

  it('className batch는 common targets와 gesture를 공용 text commit으로 전달한다', async () => {
    const targets = [
      {
        elementType: 'knob',
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      },
    ] as const;
    const gestureId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    mocks.requestListener?.(
      envelope('layers:patchProperty', {
        targets,
        patch: { className: '  Raw class  ' },
        gestureId,
      }),
    );

    await vi.waitFor(() =>
      expect(mocks.patchDisplayText).toHaveBeenCalledOnce(),
    );
    expect(mocks.patchDisplayText).toHaveBeenCalledWith(
      targets,
      { className: '  Raw class  ' },
      {
        gestureId,
        preflight: expect.any(Function),
      },
    );
    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({ ok: true });
  });

  it.each([
    ['borderWidth', 'key', { borderWidth: 12.5 }],
    ['borderRadius', 'knob', { borderRadius: 999 }],
    ['fontSize', 'graph', { fontSize: 31.5 }],
  ] as const)(
    '%s batch는 common targets와 gesture를 공용 style commit으로 전달한다',
    async (_label, elementType, patch) => {
      const targets = [
        {
          elementType,
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        },
      ] as const;
      const gestureId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      mocks.requestListener?.(
        envelope('layers:patchProperty', { targets, patch, gestureId }),
      );

      await vi.waitFor(() =>
        expect(mocks.patchDisplayText).toHaveBeenCalledOnce(),
      );
      expect(mocks.patchDisplayText).toHaveBeenCalledWith(targets, patch, {
        gestureId,
        preflight: expect.any(Function),
      });
      await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
      expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({ ok: true });
    },
  );

  it('noteGlowSize batch는 key-only literal을 gesture 없이 공용 style commit으로 전달한다', async () => {
    const targets = [
      {
        elementType: 'key',
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      },
    ] as const;
    mocks.requestListener?.(
      envelope('layers:patchProperty', {
        targets,
        patch: { noteGlowSize: 20.5 },
      }),
    );

    await vi.waitFor(() =>
      expect(mocks.patchDisplayText).toHaveBeenCalledOnce(),
    );
    expect(mocks.patchDisplayText).toHaveBeenCalledWith(
      targets,
      { noteGlowSize: 20.5 },
      { preflight: expect.any(Function) },
    );
    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({ ok: true });
  });

  it.each([
    { noteOffsetX: 0 },
    { noteOffsetY: null },
    { noteWidth: null },
    { noteBorderWidth: 2.5 },
    { noteBorderRadius: 12.5 },
  ] as const)(
    'note numeric %j batch는 key-only exact literal과 slot preflight를 전달한다',
    async (patch) => {
      const targets = [
        {
          elementType: 'key',
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        },
      ] as const;
      mocks.requestListener?.(
        envelope('layers:patchProperty', {
          targets,
          patch,
          gestureId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        }),
      );

      await vi.waitFor(() =>
        expect(mocks.patchDisplayText).toHaveBeenCalledOnce(),
      );
      expect(mocks.patchDisplayText).toHaveBeenCalledWith(targets, patch, {
        gestureId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        preflight: expect.any(Function),
      });
      await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
      expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({ ok: true });
    },
  );

  it('note numeric single target은 generic executor에 exact nullable leaf를 전달한다', async () => {
    const target = {
      elementType: 'key',
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      patch: { noteOffsetX: null },
    } as const;
    mocks.requestListener?.(
      envelope('layers:patchProperty', {
        target,
      }),
    );

    await vi.waitFor(() =>
      expect(mocks.patchElementProperty).toHaveBeenCalledOnce(),
    );
    expect(mocks.patchElementProperty).toHaveBeenCalledWith(
      'key',
      target.id,
      target.patch,
      { preflight: expect.any(Function) },
    );
  });

  it('note numeric은 slot 직전 generation 변경을 executor에서 거절한다', async () => {
    mocks.patchDisplayText.mockImplementationOnce(
      async (_targets, _patch, options) => {
        mocks.authorityGeneration = 8;
        options?.preflight?.();
        return true;
      },
    );
    mocks.requestListener?.(
      envelope('layers:patchProperty', {
        targets: [
          {
            elementType: 'key',
            id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          },
        ],
        patch: { noteWidth: null },
      }),
    );

    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'AUTHORITY_GENERATION_STALE' },
    });
    expect(mocks.patchElementProperty).not.toHaveBeenCalled();
  });

  it('note paint batch는 canonical gesture와 exact mask를 dedicated executor에 전달한다', async () => {
    const ids = ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
    mocks.requestListener?.(
      envelope('layers:patchProperty', {
        targets: ids.map((id) => ({ elementType: 'key', id })),
        patch: { notePaint: { opacity: 60 } },
        gestureId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      }),
    );

    await vi.waitFor(() => expect(mocks.patchNotePaint).toHaveBeenCalledOnce());
    expect(mocks.patchNotePaint).toHaveBeenCalledWith(
      ids,
      { notePaint: { opacity: 60 } },
      {
        gestureId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        preflight: expect.any(Function),
      },
    );
    expect(mocks.patchElementProperty).not.toHaveBeenCalled();
  });

  it('note paint single target도 generic eager를 우회한다', async () => {
    const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    mocks.requestListener?.(
      envelope('layers:patchProperty', {
        target: {
          elementType: 'key',
          id,
          patch: { noteBorderPaint: { color: '#A0B1C2', opacity: 55 } },
        },
      }),
    );

    await vi.waitFor(() => expect(mocks.patchNotePaint).toHaveBeenCalledOnce());
    expect(mocks.patchNotePaint).toHaveBeenCalledWith(
      [id],
      { noteBorderPaint: { color: '#A0B1C2', opacity: 55 } },
      { preflight: expect.any(Function) },
    );
    expect(mocks.patchElementProperty).not.toHaveBeenCalled();
  });

  it('note paint는 slot 직전 generation 변경을 dedicated executor에서 거절한다', async () => {
    mocks.patchNotePaint.mockImplementationOnce(
      async (_ids, _patch, options) => {
        mocks.authorityGeneration = 8;
        options?.preflight?.();
        return true;
      },
    );
    mocks.requestListener?.(
      envelope('layers:patchProperty', {
        targets: [
          {
            elementType: 'key',
            id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          },
        ],
        patch: { noteGlowPaint: { color: '#fff' } },
      }),
    );

    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'AUTHORITY_GENERATION_STALE' },
    });
    expect(mocks.patchElementProperty).not.toHaveBeenCalled();
  });

  it('noteGlowSize는 slot 직전 generation 변경을 executor에서 거절한다', async () => {
    mocks.patchDisplayText.mockImplementationOnce(
      async (_targets, _patch, options) => {
        mocks.authorityGeneration = 8;
        options?.preflight?.();
        return true;
      },
    );
    mocks.requestListener?.(
      envelope('layers:patchProperty', {
        targets: [
          {
            elementType: 'key',
            id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          },
        ],
        patch: { noteGlowSize: 20.5 },
      }),
    );

    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'AUTHORITY_GENERATION_STALE' },
    });
    expect(mocks.patchElementProperty).not.toHaveBeenCalled();
  });

  it('inactiveImage batch는 혼합 native 대상과 raw string을 한 semantic commit으로 전달한다', async () => {
    const targets = [
      {
        elementType: 'key',
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      {
        elementType: 'stat',
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      },
      {
        elementType: 'graph',
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      },
      {
        elementType: 'knob',
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      },
    ] as const;
    mocks.requestListener?.(
      envelope('layers:patchProperty', {
        targets,
        patch: { inactiveImage: '  Raw Image.png  ' },
      }),
    );

    await vi.waitFor(() =>
      expect(mocks.patchInactiveImage).toHaveBeenCalledOnce(),
    );
    expect(mocks.patchInactiveImage).toHaveBeenCalledWith(
      targets,
      '  Raw Image.png  ',
      { preflight: expect.any(Function) },
    );
    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({ ok: true });
  });

  it('activeImage batch는 key와 knob 대상만 raw string으로 한 commit에 전달한다', async () => {
    const targets = [
      {
        elementType: 'key',
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      {
        elementType: 'knob',
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      },
    ] as const;
    mocks.requestListener?.(
      envelope('layers:patchProperty', {
        targets,
        patch: { activeImage: '  Raw Active.png  ' },
      }),
    );

    await vi.waitFor(() =>
      expect(mocks.patchActiveImage).toHaveBeenCalledOnce(),
    );
    expect(mocks.patchActiveImage).toHaveBeenCalledWith(
      targets,
      '  Raw Active.png  ',
      { preflight: expect.any(Function) },
    );
    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({ ok: true });
  });

  it.each([
    ['idle', { idleTransparent: true }, 'patchIdleTransparent'],
    ['active', { activeTransparent: false }, 'patchActiveTransparent'],
  ] as const)(
    '%s transparency batch는 exact bool을 전용 helper에 전달한다',
    async (_label, patch, mockName) => {
      const targets = [
        {
          elementType: 'key',
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
      ] as const;
      mocks.requestListener?.(
        envelope('layers:patchProperty', { targets, patch }),
      );

      await vi.waitFor(() => expect(mocks[mockName]).toHaveBeenCalledOnce());
      expect(mocks[mockName]).toHaveBeenCalledWith(
        targets,
        Object.values(patch)[0],
        { preflight: expect.any(Function) },
      );
      await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
      expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({ ok: true });
    },
  );

  it('soundPath batch는 key ID와 raw string을 한 semantic commit으로 전달한다', async () => {
    const targets = [
      { elementType: 'key', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      { elementType: 'key', id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    ] as const;
    mocks.requestListener?.(
      envelope('layers:patchProperty', {
        targets,
        patch: { soundPath: '  sounds/raw.wav  ' },
      }),
    );

    await vi.waitFor(() => expect(mocks.patchSoundPath).toHaveBeenCalledOnce());
    expect(mocks.patchSoundPath).toHaveBeenCalledWith(
      targets.map((target) => target.id),
      '  sounds/raw.wav  ',
      { preflight: expect.any(Function) },
    );
    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({ ok: true });
  });

  it.each(['single', 'batch'] as const)(
    'soundEnabled %s은 key ID와 absolute bool을 전용 semantic commit으로 전달한다',
    async (shape) => {
      const target = {
        elementType: 'key',
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      } as const;
      const payload =
        shape === 'single'
          ? { target: { ...target, patch: { soundEnabled: true } } }
          : { targets: [target], patch: { soundEnabled: true } };
      mocks.requestListener?.(envelope('layers:patchProperty', payload));

      await vi.waitFor(() =>
        expect(mocks.patchSoundEnabled).toHaveBeenCalledOnce(),
      );
      expect(mocks.patchSoundEnabled).toHaveBeenCalledWith([target.id], true, {
        preflight: expect.any(Function),
      });
      await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
      expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({ ok: true });
    },
  );

  it('soundVolume batch는 key IDs, finite literal, gesture를 전용 semantic commit으로 전달한다', async () => {
    const targets = [
      { elementType: 'key', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      { elementType: 'key', id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    ] as const;
    mocks.requestListener?.(
      envelope('layers:patchProperty', {
        targets,
        patch: { soundVolume: 137.5 },
        gestureId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      }),
    );

    await vi.waitFor(() =>
      expect(mocks.patchSoundVolume).toHaveBeenCalledOnce(),
    );
    expect(mocks.patchSoundVolume).toHaveBeenCalledWith(
      targets.map(({ id }) => id),
      137.5,
      {
        gestureId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        preflight: expect.any(Function),
      },
    );
    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({ ok: true });
  });

  it('counter animation preset batch는 key/stat exact intent를 한 semantic commit으로 전달한다', async () => {
    const targets = [
      { elementType: 'key', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      { elementType: 'stat', id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    ] as const;
    const intent = {
      presetId: 'preset-a',
      applyPresetId: true,
      bezier: [0.25, 0.1, 0.25, 1],
      scale: 1.2,
      durationMs: 400,
    };
    mocks.requestListener?.(
      envelope('layers:patchProperty', {
        targets,
        patch: { counterAnimationPreset: intent },
      }),
    );

    await vi.waitFor(() =>
      expect(mocks.patchCounterAnimationPreset).toHaveBeenCalledOnce(),
    );
    expect(mocks.patchCounterAnimationPreset).toHaveBeenCalledWith(
      targets,
      intent,
      { preflight: expect.any(Function) },
    );
    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({ ok: true });
  });

  it.each([
    ['counterEnabled', true],
    ['counterAnimationEnabled', false],
  ] as const)(
    '%s batch는 key/stat exact bool을 전용 helper에 전달한다',
    async (field, enabled) => {
      const targets = [
        { elementType: 'key', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
        { elementType: 'stat', id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      ] as const;
      mocks.requestListener?.(
        envelope('layers:patchProperty', {
          targets,
          patch: { [field]: enabled },
        }),
      );
      const helper =
        field === 'counterEnabled'
          ? mocks.patchCounterEnabled
          : mocks.patchCounterAnimationEnabled;
      await vi.waitFor(() => expect(helper).toHaveBeenCalledOnce());
      expect(helper).toHaveBeenCalledWith(targets, enabled, {
        preflight: expect.any(Function),
      });
      expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({ ok: true });
    },
  );

  it('counter bool single은 slot 직전 generation 변경을 거절한다', async () => {
    mocks.patchCounterEnabled.mockImplementationOnce(
      async (_targets, _enabled, options) => {
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
          patch: { counterEnabled: true },
        },
      }),
    );
    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'AUTHORITY_GENERATION_STALE' },
    });
  });

  it.each([
    { counterPlacement: 'outside' },
    { counterAlign: 'right' },
    { counterAlignMode: 'between' },
    { counterGap: 4_294_967_295 },
  ] as const)(
    'counter layout batch $patch는 key/stat exact leaf를 전용 helper에 전달한다',
    async (patch) => {
      const targets = [
        { elementType: 'key', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
        { elementType: 'stat', id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      ] as const;
      mocks.requestListener?.(
        envelope('layers:patchProperty', { targets, patch }),
      );
      await vi.waitFor(() =>
        expect(mocks.patchCounterLayout).toHaveBeenCalledOnce(),
      );
      expect(mocks.patchCounterLayout).toHaveBeenCalledWith(targets, patch, {
        preflight: expect.any(Function),
      });
      expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({ ok: true });
    },
  );

  it('counter layout single은 slot 직전 generation 변경을 거절한다', async () => {
    mocks.patchCounterLayout.mockImplementationOnce(
      async (_targets, _patch, options) => {
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
          patch: { counterAlign: 'left' },
        },
      }),
    );
    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'AUTHORITY_GENERATION_STALE' },
    });
  });

  it.each([
    { counterFontSize: 72 },
    { counterFontWeight: 900 },
    { counterFontItalic: true },
    { counterFontUnderline: true },
    { counterFontStrikethrough: true },
  ] as const)(
    'counter typography batch $patch는 key/stat exact leaf를 전용 helper에 전달한다',
    async (patch) => {
      const targets = [
        { elementType: 'key', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
        { elementType: 'stat', id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      ] as const;
      mocks.requestListener?.(
        envelope('layers:patchProperty', { targets, patch }),
      );
      await vi.waitFor(() =>
        expect(mocks.patchCounterTypography).toHaveBeenCalledOnce(),
      );
      expect(mocks.patchCounterTypography).toHaveBeenCalledWith(
        targets,
        patch,
        { preflight: expect.any(Function) },
      );
      expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({ ok: true });
    },
  );

  it('counter typography single은 slot 직전 generation 변경을 거절한다', async () => {
    mocks.patchCounterTypography.mockImplementationOnce(
      async (_targets, _patch, options) => {
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
          patch: { counterFontSize: 72 },
        },
      }),
    );
    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'AUTHORITY_GENERATION_STALE' },
    });
  });

  it('counter fontFamily batch는 raw exact key/stat leaf를 전용 helper에 전달한다', async () => {
    const targets = [
      { elementType: 'key', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      { elementType: 'stat', id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    ] as const;
    mocks.requestListener?.(
      envelope('layers:patchProperty', {
        targets,
        patch: { counterFontFamily: '  Raw Counter Family  ' },
      }),
    );
    await vi.waitFor(() =>
      expect(mocks.patchCounterTypography).toHaveBeenCalledOnce(),
    );
    expect(mocks.patchCounterTypography).toHaveBeenCalledWith(
      targets,
      { counterFontFamily: '  Raw Counter Family  ' },
      { preflight: expect.any(Function) },
    );
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({ ok: true });
  });

  it('counter fontFamily single은 slot 직전 generation 변경을 거절한다', async () => {
    mocks.patchCounterTypography.mockImplementationOnce(
      async (_targets, _patch, options) => {
        mocks.authorityGeneration = 8;
        options?.preflight?.();
        return true;
      },
    );
    mocks.requestListener?.(
      envelope('layers:patchProperty', {
        target: {
          elementType: 'stat',
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          patch: { counterFontFamily: '' },
        },
      }),
    );
    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'AUTHORITY_GENERATION_STALE' },
    });
  });

  it.each([
    [
      { counterStrokeIdle: '  raw idle  ' },
      [
        { elementType: 'key', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
        { elementType: 'stat', id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      ],
    ],
    [
      { counterStrokeActive: '' },
      [{ elementType: 'key', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }],
    ],
  ] as const)(
    'counter stroke batch $0는 exact key/stat target을 전용 helper에 전달한다',
    async (patch, targets) => {
      mocks.requestListener?.(
        envelope('layers:patchProperty', { targets, patch }),
      );
      await vi.waitFor(() =>
        expect(mocks.patchCounterStroke).toHaveBeenCalledOnce(),
      );
      expect(mocks.patchCounterStroke).toHaveBeenCalledWith(targets, patch, {
        preflight: expect.any(Function),
      });
      expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({ ok: true });
    },
  );

  it('counter stroke single은 slot 직전 generation 변경을 거절한다', async () => {
    mocks.patchCounterStroke.mockImplementationOnce(
      async (_targets, _patch, options) => {
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
          patch: { counterStrokeActive: '#ffffff' },
        },
      }),
    );
    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'AUTHORITY_GENERATION_STALE' },
    });
    expect(mocks.patchElementProperty).not.toHaveBeenCalled();
  });

  it('counter fill batch는 exact descriptor를 dedicated helper에 전달한다', async () => {
    const targets = [
      { elementType: 'key', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      { elementType: 'stat', id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    ];
    const patch = { counterFillIdle: { color: ' raw solid ' } } as const;
    mocks.requestListener?.(
      envelope('layers:patchProperty', { targets, patch }),
    );

    await vi.waitFor(() =>
      expect(mocks.patchCounterFill).toHaveBeenCalledOnce(),
    );
    expect(mocks.patchCounterFill).toHaveBeenCalledWith(targets, patch, {
      preflight: expect.any(Function),
    });
    expect(mocks.patchElementProperty).not.toHaveBeenCalled();
  });

  it('counter fill single도 generic eager를 우회하고 slot generation을 검사한다', async () => {
    mocks.patchCounterFill.mockImplementationOnce(
      async (_targets, _patch, options) => {
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
          patch: { counterFillActive: { color: ' active solid ' } },
        },
      }),
    );

    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.patchCounterFill).toHaveBeenCalledOnce();
    expect(mocks.patchElementProperty).not.toHaveBeenCalled();
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'AUTHORITY_GENERATION_STALE' },
    });
  });

  it('paint batch는 exact descriptor와 slot preflight를 전용 helper에 전달한다', async () => {
    const targets = [
      { elementType: 'key', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      { elementType: 'graph', id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    ];
    const patch = {
      backgroundPaint: {
        color: '#first',
        gradient: {
          angle: 45,
          stops: [
            { color: '#first', pos: 0 },
            { color: '#last', pos: 1 },
          ],
        },
      },
    };
    mocks.requestListener?.(
      envelope('layers:patchProperty', { targets, patch }),
    );
    await vi.waitFor(() => expect(mocks.patchPaint).toHaveBeenCalledOnce());
    expect(mocks.patchPaint).toHaveBeenCalledWith(targets, patch, {
      preflight: expect.any(Function),
    });
    expect(mocks.patchElementProperty).not.toHaveBeenCalled();
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({ ok: true });
  });

  it.each([
    [
      'active wrong type',
      {
        targets: [{ elementType: 'stat', id: 'stable' }],
        patch: {
          activeBackgroundPaint: { color: '#fff', gradient: null },
        },
      },
    ],
    [
      'descriptor extra',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: {
          backgroundPaint: { color: '#fff', gradient: null, extra: true },
        },
      },
    ],
    [
      'negative zero angle',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: {
          backgroundPaint: {
            color: '#first',
            gradient: {
              angle: -0,
              stops: [
                { color: '#first', pos: 0 },
                { color: '#last', pos: 1 },
              ],
            },
          },
        },
      },
    ],
    [
      'base mismatch',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: {
          backgroundPaint: {
            color: '#mismatch',
            gradient: {
              angle: 45,
              stops: [
                { color: '#first', pos: 0 },
                { color: '#last', pos: 1 },
              ],
            },
          },
        },
      },
    ],
    [
      'combined',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: {
          backgroundPaint: { color: '#fff', gradient: null },
          borderPaint: { color: '#000', gradient: null },
        },
      },
    ],
  ])(
    'paint invalid %s는 executor를 호출하지 않는다',
    async (_label, payload) => {
      mocks.requestListener?.(envelope('layers:patchProperty', payload));
      await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
      expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
        ok: false,
        error: { code: 'INVALID_PAYLOAD' },
      });
      expect(mocks.patchPaint).not.toHaveBeenCalled();
      expect(mocks.patchElementProperty).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      targets: [{ elementType: 'graph', id: 'a' }],
      patch: { counterAnimationPreset: { presetId: 'a' } },
    },
    {
      targets: [{ elementType: 'key', id: 'a' }],
      patch: {
        counterAnimationPreset: { presetId: 'a', applyPresetId: false },
      },
    },
    {
      targets: [{ elementType: 'key', id: 'a' }],
      patch: {
        counterAnimationPreset: { presetId: 'a', bezier: [-0.1, 0, 0, 1] },
      },
    },
    {
      targets: [{ elementType: 'key', id: 'a' }],
      patch: { counterAnimationPreset: { presetId: 'a', durationMs: 0 } },
    },
    {
      targets: [{ elementType: 'key', id: 'a' }],
      patch: { counterAnimationPreset: { presetId: 'a' }, fontItalic: true },
    },
    {
      targets: [{ elementType: 'graph', id: 'a' }],
      patch: { counterEnabled: true },
    },
    {
      targets: [{ elementType: 'knob', id: 'a' }],
      patch: { counterAnimationEnabled: true },
    },
    {
      targets: [{ elementType: 'key', id: 'a' }],
      patch: { counterEnabled: 1 },
    },
    {
      targets: [{ elementType: 'key', id: 'a' }],
      patch: { counterEnabled: true, counterAnimationEnabled: false },
    },
    {
      targets: [{ elementType: 'graph', id: 'a' }],
      patch: { counterPlacement: 'inside' },
    },
    {
      targets: [{ elementType: 'key', id: 'a' }],
      patch: { counterPlacement: 'middle' },
    },
    {
      targets: [{ elementType: 'stat', id: 'a' }],
      patch: { counterAlign: 'center' },
    },
    {
      targets: [{ elementType: 'key', id: 'a' }],
      patch: { counterAlignMode: 'ends' },
    },
    {
      targets: [{ elementType: 'key', id: 'a' }],
      patch: { counterGap: 4_294_967_296 },
    },
    {
      targets: [{ elementType: 'key', id: 'a' }],
      patch: { counterGap: 1.5 },
    },
    {
      targets: [{ elementType: 'key', id: 'a' }],
      patch: { counterGap: 4, counterAlign: 'top' },
    },
    {
      targets: [{ elementType: 'graph', id: 'a' }],
      patch: { counterFontSize: 12 },
    },
    {
      targets: [{ elementType: 'key', id: 'a' }],
      patch: { counterFontSize: 7 },
    },
    {
      targets: [{ elementType: 'stat', id: 'a' }],
      patch: { counterFontWeight: 901 },
    },
    {
      targets: [{ elementType: 'key', id: 'a' }],
      patch: { counterFontWeight: 400.5 },
    },
    {
      targets: [{ elementType: 'key', id: 'a' }],
      patch: { counterFontItalic: 1 },
    },
    {
      targets: [{ elementType: 'key', id: 'a' }],
      patch: { counterFontUnderline: true, counterFontStrikethrough: false },
    },
    {
      targets: [{ elementType: 'graph', id: 'a' }],
      patch: { counterFontFamily: 'Counter' },
    },
    {
      targets: [{ elementType: 'knob', id: 'a' }],
      patch: { counterFontFamily: '' },
    },
    {
      targets: [{ elementType: 'key', id: 'a' }],
      patch: { counterFontFamily: null },
    },
    {
      targets: [{ elementType: 'stat', id: 'a' }],
      patch: { counterFontFamily: 'Counter', counterFontItalic: true },
    },
    {
      targets: [{ elementType: 'graph', id: 'a' }],
      patch: { counterStrokeIdle: '#fff' },
    },
    {
      targets: [{ elementType: 'stat', id: 'a' }],
      patch: { counterStrokeActive: '#fff' },
    },
    {
      targets: [{ elementType: 'key', id: 'a' }],
      patch: { counterStrokeIdle: null },
    },
    {
      targets: [{ elementType: 'key', id: 'a' }],
      patch: { counterStrokeIdle: '#fff', counterStrokeActive: '#000' },
    },
    {
      targets: [
        { elementType: 'key', id: 'a' },
        { elementType: 'stat', id: 'a' },
      ],
      patch: { counterStrokeIdle: '#fff' },
    },
    {
      targets: [{ elementType: 'key', id: 'key-0' }],
      patch: { counterStrokeActive: '#fff' },
    },
    {
      targets: Array.from({ length: 4097 }, (_, index) => ({
        elementType: 'key',
        id: `counter-stroke-${index}`,
      })),
      patch: { counterStrokeActive: '#fff' },
    },
    {
      targets: [{ elementType: 'graph', id: 'a' }],
      patch: { counterFillIdle: { color: '#fff' } },
    },
    {
      targets: [{ elementType: 'stat', id: 'a' }],
      patch: { counterFillActive: { color: '#fff' } },
    },
    {
      targets: [{ elementType: 'key', id: 'a' }],
      patch: { counterFillIdle: { color: '#fff', gradient: null } },
    },
    {
      targets: [{ elementType: 'key', id: 'a' }],
      patch: {
        counterFillIdle: {
          color: '#112233',
          gradient: {
            angle: 45,
            stops: [
              { color: '#112233', pos: 0 },
              { color: '#445566', pos: 1 },
            ],
          },
        },
      },
    },
    {
      targets: [{ elementType: 'key', id: 'key-0' }],
      patch: { counterFillIdle: { color: '#fff' } },
    },
    {
      targets: [
        { elementType: 'key', id: 'a' },
        { elementType: 'stat', id: 'a' },
      ],
      patch: { counterGap: 4 },
    },
    {
      targets: [{ elementType: 'key', id: 'key-0' }],
      patch: { counterGap: 4 },
    },
    {
      targets: Array.from({ length: 4097 }, (_, index) => ({
        elementType: 'key',
        id: `counter-layout-${index}`,
      })),
      patch: { counterGap: 4 },
    },
  ])(
    'counter animation invalid exact payload를 executor 전에 거절한다',
    async (payload) => {
      mocks.requestListener?.(envelope('layers:patchProperty', payload));
      await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
      expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
        ok: false,
        error: { code: 'INVALID_PAYLOAD' },
      });
      expect(mocks.patchCounterAnimationPreset).not.toHaveBeenCalled();
      expect(mocks.patchCounterEnabled).not.toHaveBeenCalled();
      expect(mocks.patchCounterAnimationEnabled).not.toHaveBeenCalled();
      expect(mocks.patchCounterLayout).not.toHaveBeenCalled();
      expect(mocks.patchCounterTypography).not.toHaveBeenCalled();
      expect(mocks.patchCounterStroke).not.toHaveBeenCalled();
    },
  );

  it('counter animation preset update/delete는 exact main authority API 결과를 응답한다', async () => {
    const request = {
      id: 'preset-a',
      name: 'Preset A',
      bezier: [0.25, 0.1, 0.25, 1],
      scale: 1.2,
      durationMs: 400,
    };
    mocks.requestListener?.(
      envelope('counterAnimation:updatePreset', { request }),
    );
    await vi.waitFor(() =>
      expect(mocks.updateCounterAnimation).toHaveBeenCalledOnce(),
    );
    expect(mocks.updateCounterAnimation).toHaveBeenCalledWith(request, {
      preflight: expect.any(Function),
    });
    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: true,
      payload: { affectedUsageCount: 2 },
    });

    mocks.respond.mockClear();
    mocks.requestListener?.(
      envelope('counterAnimation:deletePreset', { id: 'preset-a' }),
    );
    await vi.waitFor(() =>
      expect(mocks.deleteCounterAnimation).toHaveBeenCalledOnce(),
    );
    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: true,
      payload: { success: true, id: 'preset-a' },
    });
  });

  it('counter animation preset mutation은 시작과 슬롯 진입에서 generation을 검사한다', async () => {
    mocks.authorityGeneration = 8;
    mocks.requestListener?.(
      envelope('counterAnimation:deletePreset', { id: 'preset-a' }),
    );
    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.deleteCounterAnimation).not.toHaveBeenCalled();
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'AUTHORITY_GENERATION_STALE' },
    });

    mocks.authorityGeneration = 7;
    mocks.respond.mockClear();
    mocks.updateCounterAnimation.mockImplementationOnce(
      async (_request, options) => {
        mocks.authorityGeneration = 8;
        (options as { preflight?: () => void })?.preflight?.();
        return null;
      },
    );
    mocks.requestListener?.(
      envelope('counterAnimation:updatePreset', {
        request: {
          id: 'preset-a',
          name: 'Preset A',
          bezier: [0.25, 0.1, 0.25, 1],
          scale: 1.2,
          durationMs: 400,
        },
      }),
    );
    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'AUTHORITY_GENERATION_STALE' },
    });
  });

  it('counter animation preset mutation 완료 전에 generation이 바뀌면 성공으로 응답하지 않는다', async () => {
    let finish!: (value: unknown) => void;
    mocks.deleteCounterAnimation.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    mocks.requestListener?.(
      envelope('counterAnimation:deletePreset', { id: 'preset-a' }),
    );
    await vi.waitFor(() =>
      expect(mocks.deleteCounterAnimation).toHaveBeenCalledOnce(),
    );

    mocks.authorityGeneration = 8;
    finish({ success: true, id: 'preset-a' });

    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'AUTHORITY_GENERATION_STALE' },
    });
  });

  it.each([
    ['counterAnimation:updatePreset', { request: { id: 'a' } }],
    [
      'counterAnimation:updatePreset',
      {
        request: {
          id: 'a',
          name: 'A',
          bezier: [0, 0, 1, 1],
          scale: 1,
          durationMs: 300,
        },
        extra: true,
      },
    ],
    ['counterAnimation:deletePreset', { id: '' }],
    ['counterAnimation:deletePreset', { id: 'a', extra: true }],
  ])(
    '%s invalid descriptor를 main API 전에 거절한다',
    async (operation, payload) => {
      mocks.requestListener?.(envelope(operation, payload));
      await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
      expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({ ok: false });
      expect(mocks.updateCounterAnimation).not.toHaveBeenCalled();
      expect(mocks.deleteCounterAnimation).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{ noteEffectEnabled: false }],
    [{ noteAutoYCorrection: true }],
    [{ noteGlowEnabled: false }],
    [{ noteAlignment: 'right' }],
    [{ noteBorderSide: 'horizontal' }],
  ] as const)(
    'note batch %j는 key ID를 ordered semantic commit 하나로 전달한다',
    async (patch) => {
      const ids = [
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      ];
      mocks.requestListener?.(
        envelope('layers:patchProperty', {
          targets: ids.map((id) => ({ elementType: 'key', id })),
          patch,
        }),
      );

      await vi.waitFor(() =>
        expect(mocks.patchNoteProperties).toHaveBeenCalledOnce(),
      );
      expect(mocks.patchNoteProperties).toHaveBeenCalledWith(ids, patch, {
        preflight: expect.any(Function),
      });
      await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
      expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({ ok: true });
    },
  );

  it.each([
    ['민감도', { sensitivity: 1.25 }],
    ['방향 반전', { reverse: true }],
  ])(
    'native knob %s exact literal을 main semantic executor에 전달한다',
    async (_label, patch) => {
      mocks.requestListener?.(
        envelope('layers:patchProperty', {
          target: {
            elementType: 'knob',
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            patch,
          },
        }),
      );

      await vi.waitFor(() =>
        expect(mocks.patchElementProperty).toHaveBeenCalledOnce(),
      );
      expect(mocks.patchElementProperty).toHaveBeenCalledWith(
        'knob',
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

  it('graphColor batch는 ordered stable IDs를 semantic batch executor에 한 번 전달한다', async () => {
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
        patch: { graphColor: '#12abEF' },
      }),
    );

    await vi.waitFor(() =>
      expect(mocks.patchGraphColors).toHaveBeenCalledOnce(),
    );
    expect(mocks.patchGraphColors).toHaveBeenCalledWith(
      [
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      ],
      '#12abEF',
      { preflight: expect.any(Function) },
    );
    expect(mocks.patchElementProperty).not.toHaveBeenCalled();
    expect(mocks.patchGraphTypes).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({ ok: true });
  });

  it.each([
    ['평균선', { showAvgLine: false }],
    ['그래프 애니메이션', { graphAnimationEnabled: true }],
    ['그래프 속도', { graphSpeed: 1200 }],
  ])(
    'graph %s batch는 exact literal과 ordered IDs를 한 semantic commit으로 전달한다',
    async (_label, patch) => {
      const ids = [
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      ];
      mocks.requestListener?.(
        envelope('layers:patchProperty', {
          targets: ids.map((id) => ({ elementType: 'graph', id })),
          patch,
        }),
      );

      await vi.waitFor(() =>
        expect(mocks.patchGraphProperties).toHaveBeenCalledOnce(),
      );
      expect(mocks.patchGraphProperties).toHaveBeenCalledWith(ids, patch, {
        preflight: expect.any(Function),
      });
      await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
      expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({ ok: true });
    },
  );

  it.each([
    ['민감도', { sensitivity: 1.25 }],
    ['방향 반전', { reverse: true }],
  ])(
    'knob %s batch는 exact literal과 ordered IDs를 한 semantic commit으로 전달한다',
    async (_label, patch) => {
      const ids = [
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      ];
      mocks.requestListener?.(
        envelope('layers:patchProperty', {
          targets: ids.map((id) => ({ elementType: 'knob', id })),
          patch,
        }),
      );

      await vi.waitFor(() =>
        expect(mocks.patchKnobProperties).toHaveBeenCalledOnce(),
      );
      expect(mocks.patchKnobProperties).toHaveBeenCalledWith(ids, patch, {
        preflight: expect.any(Function),
      });
      await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
      expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({ ok: true });
    },
  );

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
      'batch empty id',
      {
        targets: [{ elementType: 'graph', id: ' ' }],
        patch: { graphColor: '#ffffff' },
      },
    ],
    [
      'batch synthetic id',
      {
        targets: [{ elementType: 'graph', id: 'graph-0' }],
        patch: { graphColor: '#ffffff' },
      },
    ],
    [
      'batch target extra',
      {
        targets: [{ elementType: 'graph', id: 'stable', index: 0 }],
        patch: { graphColor: '#ffffff' },
      },
    ],
    [
      'batch top-level extra',
      {
        targets: [{ elementType: 'graph', id: 'stable' }],
        patch: { graphColor: '#ffffff' },
        extra: true,
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
      'single graph color wrong type',
      {
        target: {
          elementType: 'stat',
          id: 'stable',
          patch: { graphColor: '#ffffff' },
        },
      },
    ],
    [
      'single graph color invalid value',
      {
        target: {
          elementType: 'graph',
          id: 'stable',
          patch: { graphColor: 42 },
        },
      },
    ],
    [
      'batch graph color invalid value',
      {
        targets: [{ elementType: 'graph', id: 'stable' }],
        patch: { graphColor: false },
      },
    ],
    [
      'batch graph leaves combined',
      {
        targets: [{ elementType: 'graph', id: 'stable' }],
        patch: { graphType: 'bar', graphColor: '#ffffff' },
      },
    ],
    [
      'graph runtime leaf wrong type',
      {
        target: {
          elementType: 'knob',
          id: 'stable',
          patch: { showAvgLine: true },
        },
      },
    ],
    [
      'knob runtime leaf wrong type',
      {
        target: {
          elementType: 'graph',
          id: 'stable',
          patch: { reverse: true },
        },
      },
    ],
    [
      'axisId wrong type',
      {
        target: {
          elementType: 'graph',
          id: 'stable',
          patch: { axisId: 'HIDA:test' },
        },
      },
    ],
    [
      'axisId non-string',
      {
        target: {
          elementType: 'knob',
          id: 'stable',
          patch: { axisId: 1 },
        },
      },
    ],
    [
      'axisId combined',
      {
        target: {
          elementType: 'knob',
          id: 'stable',
          patch: { axisId: 'HIDA:test', reverse: true },
        },
      },
    ],
    [
      'axisId extra',
      {
        target: {
          elementType: 'knob',
          id: 'stable',
          patch: { axisId: 'HIDA:test', extra: true },
        },
      },
    ],
    [
      'graphSpeed fractional',
      {
        targets: [{ elementType: 'graph', id: 'stable' }],
        patch: { graphSpeed: 1.5 },
      },
    ],
    [
      'graphSpeed negative',
      {
        targets: [{ elementType: 'graph', id: 'stable' }],
        patch: { graphSpeed: -1 },
      },
    ],
    [
      'graphSpeed overflow',
      {
        targets: [{ elementType: 'graph', id: 'stable' }],
        patch: { graphSpeed: 4_294_967_296 },
      },
    ],
    [
      'sensitivity nonfinite',
      {
        targets: [{ elementType: 'knob', id: 'stable' }],
        patch: { sensitivity: Number.POSITIVE_INFINITY },
      },
    ],
    [
      'runtime leaves combined',
      {
        targets: [{ elementType: 'graph', id: 'stable' }],
        patch: { showAvgLine: true, graphSpeed: 1200 },
      },
    ],
    [
      'font leaves combined',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { fontItalic: true, fontUnderline: true },
      },
    ],
    [
      'font leaf extra',
      {
        targets: [{ elementType: 'stat', id: 'stable' }],
        patch: { fontItalic: true, extra: true },
      },
    ],
    [
      'fontFamily null',
      {
        targets: [{ elementType: 'stat', id: 'stable' }],
        patch: { fontFamily: null },
      },
    ],
    [
      'fontFamily combined',
      {
        targets: [{ elementType: 'stat', id: 'stable' }],
        patch: { fontFamily: 'Family', fontItalic: true },
      },
    ],
    [
      'displayText non-string',
      {
        targets: [
          {
            elementType: 'key',
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          },
        ],
        patch: { displayText: 1 },
      },
    ],
    [
      'displayText combined',
      {
        targets: [
          {
            elementType: 'graph',
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          },
        ],
        patch: { displayText: 'Graph', fontItalic: true },
      },
    ],
    [
      'displayText non canonical gesture',
      {
        targets: [
          {
            elementType: 'stat',
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          },
        ],
        patch: { displayText: '' },
        gestureId: 'not-a-uuid',
      },
    ],
    [
      'className null',
      {
        targets: [
          {
            elementType: 'knob',
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          },
        ],
        patch: { className: null },
      },
    ],
    [
      'className combined',
      {
        targets: [
          {
            elementType: 'key',
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          },
        ],
        patch: { className: 'key-class', displayText: 'Key' },
      },
    ],
    [
      'className extra',
      {
        targets: [
          {
            elementType: 'graph',
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          },
        ],
        patch: { className: 'graph-class', extra: true },
      },
    ],
    [
      'className non canonical gesture',
      {
        targets: [
          {
            elementType: 'stat',
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          },
        ],
        patch: { className: '' },
        gestureId: 'not-a-uuid',
      },
    ],
    [
      'borderWidth below range',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { borderWidth: -0.1 },
      },
    ],
    [
      'borderWidth nonfinite',
      {
        targets: [{ elementType: 'stat', id: 'stable' }],
        patch: { borderWidth: Number.POSITIVE_INFINITY },
      },
    ],
    [
      'borderRadius non-knob above range',
      {
        targets: [{ elementType: 'graph', id: 'stable' }],
        patch: { borderRadius: 100.1 },
      },
    ],
    [
      'borderRadius knob above range',
      {
        targets: [{ elementType: 'knob', id: 'stable' }],
        patch: { borderRadius: 999.1 },
      },
    ],
    [
      'fontSize below range',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { fontSize: 7.9 },
      },
    ],
    [
      'numeric style non-number',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { fontSize: '12' },
      },
    ],
    [
      'numeric style combined',
      {
        targets: [{ elementType: 'knob', id: 'stable' }],
        patch: { borderWidth: 1, borderRadius: 2 },
      },
    ],
    [
      'numeric style extra',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { fontSize: 12, extra: true },
      },
    ],
    [
      'noteGlowSize wrong type',
      {
        targets: [{ elementType: 'stat', id: 'stable' }],
        patch: { noteGlowSize: 20 },
      },
    ],
    [
      'noteGlowSize below range',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { noteGlowSize: -0.1 },
      },
    ],
    [
      'noteGlowSize above range',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { noteGlowSize: 50.1 },
      },
    ],
    [
      'noteGlowSize nonfinite',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { noteGlowSize: Number.NaN },
      },
    ],
    [
      'noteGlowSize combined',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { noteGlowSize: 20, noteGlowEnabled: true },
      },
    ],
    [
      'noteGlowSize null',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { noteGlowSize: null },
      },
    ],
    [
      'noteGlowSize extra',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { noteGlowSize: 20, extra: true },
      },
    ],
    [
      'note numeric wrong type',
      {
        targets: [{ elementType: 'stat', id: 'stable' }],
        patch: { noteOffsetX: 0 },
      },
    ],
    [
      'note offset nonfinite',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { noteOffsetY: Number.POSITIVE_INFINITY },
      },
    ],
    [
      'note offset range',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { noteOffsetX: -500.1 },
      },
    ],
    [
      'note width zero',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { noteWidth: 0 },
      },
    ],
    [
      'note border width null',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { noteBorderWidth: null },
      },
    ],
    [
      'note border radius range',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { noteBorderRadius: 100.1 },
      },
    ],
    [
      'note numeric combined',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { noteOffsetX: 0, noteOffsetY: 0 },
      },
    ],
    [
      'note numeric extra',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { noteWidth: null, extra: true },
      },
    ],
    [
      'note paint wrong type',
      {
        targets: [{ elementType: 'stat', id: 'stable' }],
        patch: { notePaint: { color: '#fff' } },
      },
    ],
    [
      'note paint incomplete gradient',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: {
          notePaint: { color: { type: 'gradient', top: '#fff' } },
        },
      },
    ],
    [
      'note paint opacity range',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { noteGlowPaint: { opacity: 101 } },
      },
    ],
    [
      'note paint incomplete opacity tuple',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { notePaint: { opacity: 50, opacityTop: 40 } },
      },
    ],
    [
      'note paint combined',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { notePaint: { color: '#fff' }, noteGlowPaint: { opacity: 50 } },
      },
    ],
    [
      'note border paint invalid color',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { noteBorderPaint: { color: '#fff', opacity: 50 } },
      },
    ],
    [
      'note paint non canonical gesture',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { notePaint: { opacity: 50 } },
        gestureId: 'not-a-uuid',
      },
    ],
    [
      'numeric style duplicate target',
      {
        targets: [
          { elementType: 'key', id: 'stable' },
          { elementType: 'key', id: 'stable' },
        ],
        patch: { borderWidth: 10 },
      },
    ],
    [
      'numeric style synthetic target',
      {
        targets: [{ elementType: 'graph', id: 'graph-0' }],
        patch: { borderRadius: 10 },
      },
    ],
    [
      'numeric style oversized batch',
      {
        targets: Array.from({ length: 4097 }, (_, index) => ({
          elementType: 'stat',
          id: `stable-numeric-style-${index}`,
        })),
        patch: { fontSize: 12 },
      },
    ],
    [
      'inactiveImage non-string',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { inactiveImage: null },
      },
    ],
    [
      'inactiveImage combined',
      {
        targets: [{ elementType: 'graph', id: 'stable' }],
        patch: { inactiveImage: 'idle.png', activeImage: 'active.png' },
      },
    ],
    [
      'inactiveImage extra',
      {
        targets: [{ elementType: 'knob', id: 'stable' }],
        patch: { inactiveImage: 'idle.png', extra: true },
      },
    ],
    [
      'inactiveImage duplicate target',
      {
        targets: [
          { elementType: 'key', id: 'stable' },
          { elementType: 'key', id: 'stable' },
        ],
        patch: { inactiveImage: 'idle.png' },
      },
    ],
    [
      'inactiveImage synthetic target',
      {
        targets: [{ elementType: 'graph', id: 'graph-0' }],
        patch: { inactiveImage: 'idle.png' },
      },
    ],
    [
      'inactiveImage oversized batch',
      {
        targets: Array.from({ length: 4097 }, (_, index) => ({
          elementType: 'stat',
          id: `stable-image-${index}`,
        })),
        patch: { inactiveImage: 'idle.png' },
      },
    ],
    [
      'activeImage wrong stat type',
      {
        targets: [{ elementType: 'stat', id: 'stable' }],
        patch: { activeImage: 'active.png' },
      },
    ],
    [
      'activeImage wrong graph type',
      {
        targets: [{ elementType: 'graph', id: 'stable' }],
        patch: { activeImage: 'active.png' },
      },
    ],
    [
      'activeImage non-string',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { activeImage: null },
      },
    ],
    [
      'activeImage combined',
      {
        targets: [{ elementType: 'knob', id: 'stable' }],
        patch: { activeImage: 'active.png', inactiveImage: 'idle.png' },
      },
    ],
    [
      'activeImage duplicate target',
      {
        targets: [
          { elementType: 'key', id: 'stable' },
          { elementType: 'knob', id: 'stable' },
        ],
        patch: { activeImage: 'active.png' },
      },
    ],
    [
      'activeImage synthetic target',
      {
        targets: [{ elementType: 'knob', id: 'knob-0' }],
        patch: { activeImage: 'active.png' },
      },
    ],
    [
      'activeImage oversized batch',
      {
        targets: Array.from({ length: 4097 }, (_, index) => ({
          elementType: 'key',
          id: `stable-active-${index}`,
        })),
        patch: { activeImage: 'active.png' },
      },
    ],
    [
      'idleTransparent non-boolean',
      {
        targets: [{ elementType: 'graph', id: 'stable-idle-transparent' }],
        patch: { idleTransparent: 1 },
      },
    ],
    [
      'idleTransparent combined',
      {
        targets: [{ elementType: 'key', id: 'stable-idle-transparent' }],
        patch: { idleTransparent: true, activeTransparent: false },
      },
    ],
    [
      'activeTransparent wrong stat type',
      {
        targets: [{ elementType: 'stat', id: 'stable-active-transparent' }],
        patch: { activeTransparent: true },
      },
    ],
    [
      'activeTransparent wrong graph type',
      {
        targets: [{ elementType: 'graph', id: 'stable-active-transparent' }],
        patch: { activeTransparent: true },
      },
    ],
    [
      'activeTransparent non-boolean',
      {
        targets: [{ elementType: 'key', id: 'stable-active-transparent' }],
        patch: { activeTransparent: 'true' },
      },
    ],
    [
      'activeTransparent duplicate target',
      {
        targets: [
          { elementType: 'key', id: 'stable-active-transparent' },
          { elementType: 'knob', id: 'stable-active-transparent' },
        ],
        patch: { activeTransparent: true },
      },
    ],
    [
      'idleTransparent synthetic target',
      {
        targets: [{ elementType: 'graph', id: 'graph-0' }],
        patch: { idleTransparent: true },
      },
    ],
    [
      'idleTransparent oversized batch',
      {
        targets: Array.from({ length: 4097 }, (_, index) => ({
          elementType: 'key',
          id: `stable-transparent-${index}`,
        })),
        patch: { idleTransparent: true },
      },
    ],
    [
      'idleImageFit invalid enum',
      {
        target: {
          elementType: 'graph',
          id: 'stable-fit',
          patch: { idleImageFit: 'stretch' },
        },
      },
    ],
    [
      'idleImageFit combined',
      {
        target: {
          elementType: 'key',
          id: 'stable-fit',
          patch: { idleImageFit: 'cover', activeImageFit: 'contain' },
        },
      },
    ],
    [
      'activeImageFit wrong stat type',
      {
        target: {
          elementType: 'stat',
          id: 'stable-fit',
          patch: { activeImageFit: 'contain' },
        },
      },
    ],
    [
      'activeImageFit wrong graph type',
      {
        target: {
          elementType: 'graph',
          id: 'stable-fit',
          patch: { activeImageFit: 'fill' },
        },
      },
    ],
    [
      'activeImageFit non-string',
      {
        target: {
          elementType: 'key',
          id: 'stable-fit',
          patch: { activeImageFit: 1 },
        },
      },
    ],
    [
      'soundEnabled wrong stat type',
      {
        targets: [{ elementType: 'stat', id: 'stable' }],
        patch: { soundEnabled: true },
      },
    ],
    [
      'soundEnabled non-boolean',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { soundEnabled: 1 },
      },
    ],
    [
      'soundEnabled combined',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { soundEnabled: true, soundPath: 'sounds/key.wav' },
      },
    ],
    [
      'soundEnabled duplicate target',
      {
        targets: [
          { elementType: 'key', id: 'stable' },
          { elementType: 'key', id: 'stable' },
        ],
        patch: { soundEnabled: true },
      },
    ],
    [
      'soundEnabled synthetic target',
      {
        targets: [{ elementType: 'key', id: 'key-0' }],
        patch: { soundEnabled: true },
      },
    ],
    [
      'soundEnabled oversized batch',
      {
        targets: Array.from({ length: 4097 }, (_, index) => ({
          elementType: 'key',
          id: `stable-sound-enabled-${index}`,
        })),
        patch: { soundEnabled: true },
      },
    ],
    [
      'soundVolume wrong stat type',
      {
        targets: [{ elementType: 'stat', id: 'stable' }],
        patch: { soundVolume: 100 },
      },
    ],
    [
      'soundVolume below range',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { soundVolume: -0.1 },
      },
    ],
    [
      'soundVolume above range',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { soundVolume: 200.1 },
      },
    ],
    [
      'soundVolume non-number',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { soundVolume: '100' },
      },
    ],
    [
      'soundVolume NaN',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { soundVolume: Number.NaN },
      },
    ],
    [
      'soundVolume infinity',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { soundVolume: Number.POSITIVE_INFINITY },
      },
    ],
    [
      'soundVolume combined',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { soundVolume: 100, soundEnabled: true },
      },
    ],
    [
      'soundVolume non canonical gesture',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { soundVolume: 100 },
        gestureId: 'bad space',
      },
    ],
    [
      'soundVolume oversized gesture',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { soundVolume: 100 },
        gestureId: `${'a'.repeat(65)}`,
      },
    ],
    [
      'other property gesture',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { soundEnabled: true },
        gestureId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      },
    ],
    [
      'soundVolume duplicate target',
      {
        targets: [
          { elementType: 'key', id: 'stable' },
          { elementType: 'key', id: 'stable' },
        ],
        patch: { soundVolume: 100 },
      },
    ],
    [
      'soundVolume synthetic target',
      {
        targets: [{ elementType: 'key', id: 'key-0' }],
        patch: { soundVolume: 100 },
      },
    ],
    [
      'soundVolume oversized batch',
      {
        targets: Array.from({ length: 4097 }, (_, index) => ({
          elementType: 'key',
          id: `stable-sound-volume-${index}`,
        })),
        patch: { soundVolume: 100 },
      },
    ],
    [
      'soundPath wrong stat type',
      {
        targets: [{ elementType: 'stat', id: 'stable' }],
        patch: { soundPath: 'sounds/stat.wav' },
      },
    ],
    [
      'soundPath single wrong stat type',
      {
        target: {
          elementType: 'stat',
          id: 'stable',
          patch: { soundPath: 'sounds/stat.wav' },
        },
      },
    ],
    [
      'soundPath non-string',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { soundPath: null },
      },
    ],
    [
      'soundPath combined',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { soundPath: 'sounds/key.wav', soundEnabled: true },
      },
    ],
    [
      'soundPath extra',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { soundPath: 'sounds/key.wav', extra: true },
      },
    ],
    [
      'soundPath duplicate target',
      {
        targets: [
          { elementType: 'key', id: 'stable' },
          { elementType: 'key', id: 'stable' },
        ],
        patch: { soundPath: 'sounds/key.wav' },
      },
    ],
    [
      'soundPath synthetic target',
      {
        targets: [{ elementType: 'key', id: 'key-0' }],
        patch: { soundPath: 'sounds/key.wav' },
      },
    ],
    [
      'soundPath oversized batch',
      {
        targets: Array.from({ length: 4097 }, (_, index) => ({
          elementType: 'key',
          id: `stable-sound-${index}`,
        })),
        patch: { soundPath: 'sounds/key.wav' },
      },
    ],
    [
      'fontWeight fractional',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { fontWeight: 700.5 },
      },
    ],
    [
      'fontWeight negative',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { fontWeight: -1 },
      },
    ],
    [
      'fontWeight overflow',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { fontWeight: 4_294_967_296 },
      },
    ],
    [
      'font boolean wrong type',
      {
        targets: [{ elementType: 'graph', id: 'stable' }],
        patch: { fontStrikethrough: 1 },
      },
    ],
    [
      'font batch duplicate id',
      {
        targets: [
          { elementType: 'key', id: 'stable' },
          { elementType: 'knob', id: 'stable' },
        ],
        patch: { fontUnderline: true },
      },
    ],
    [
      'font batch synthetic id',
      {
        targets: [{ elementType: 'stat', id: 'stat-0' }],
        patch: { fontItalic: true },
      },
    ],
    [
      'font batch empty id',
      {
        targets: [{ elementType: 'key', id: ' ' }],
        patch: { fontWeight: 700 },
      },
    ],
    [
      'font batch oversized',
      {
        targets: Array.from({ length: 4097 }, (_, index) => ({
          elementType: 'key',
          id: `stable-font-${index}`,
        })),
        patch: { fontWeight: 700 },
      },
    ],
    [
      'note leaf wrong native type',
      {
        targets: [{ elementType: 'stat', id: 'stable' }],
        patch: { noteEffectEnabled: true },
      },
    ],
    [
      'note enum invalid',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { noteAlignment: 'top' },
      },
    ],
    [
      'note border enum invalid',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { noteBorderSide: 'left' },
      },
    ],
    [
      'note bool invalid',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { noteGlowEnabled: 1 },
      },
    ],
    [
      'note leaves combined',
      {
        targets: [{ elementType: 'key', id: 'stable' }],
        patch: { noteEffectEnabled: true, noteGlowEnabled: true },
      },
    ],
    [
      'note batch duplicate id',
      {
        targets: [
          { elementType: 'key', id: 'stable' },
          { elementType: 'key', id: 'stable' },
        ],
        patch: { noteAutoYCorrection: false },
      },
    ],
    [
      'note batch synthetic id',
      {
        targets: [{ elementType: 'key', id: 'key-0' }],
        patch: { noteAlignment: 'center' },
      },
    ],
    [
      'note batch empty id',
      {
        targets: [{ elementType: 'key', id: ' ' }],
        patch: { noteBorderSide: 'all' },
      },
    ],
    [
      'note batch oversized',
      {
        targets: Array.from({ length: 4097 }, (_, index) => ({
          elementType: 'key',
          id: `stable-note-${index}`,
        })),
        patch: { noteEffectEnabled: true },
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
      '인라인 스타일 batch plugin target',
      {
        targets: [{ elementType: 'plugin', id: 'plugin-a:one' }],
        patch: { useInlineStyles: true },
      },
    ],
    [
      '인라인 스타일 batch mixed duplicate id',
      {
        targets: [
          { elementType: 'key', id: 'stable' },
          { elementType: 'knob', id: 'stable' },
        ],
        patch: { useInlineStyles: true },
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
      expect(mocks.patchGraphColors).not.toHaveBeenCalled();
      expect(mocks.patchGraphProperties).not.toHaveBeenCalled();
      expect(mocks.patchKnobProperties).not.toHaveBeenCalled();
      expect(mocks.patchUseInlineStyles).not.toHaveBeenCalled();
      expect(mocks.patchFontStyle).not.toHaveBeenCalled();
      expect(mocks.patchFontFamily).not.toHaveBeenCalled();
      expect(mocks.patchDisplayText).not.toHaveBeenCalled();
      expect(mocks.patchInactiveImage).not.toHaveBeenCalled();
      expect(mocks.patchActiveImage).not.toHaveBeenCalled();
      expect(mocks.patchIdleTransparent).not.toHaveBeenCalled();
      expect(mocks.patchActiveTransparent).not.toHaveBeenCalled();
      expect(mocks.patchSoundPath).not.toHaveBeenCalled();
      expect(mocks.patchSoundEnabled).not.toHaveBeenCalled();
      expect(mocks.patchSoundVolume).not.toHaveBeenCalled();
      expect(mocks.patchNoteProperties).not.toHaveBeenCalled();
      expect(mocks.patchNotePaint).not.toHaveBeenCalled();
      expect(mocks.patchCounterFill).not.toHaveBeenCalled();
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

  it('axisId는 main 직렬 슬롯 진입 전에 generation을 다시 검사한다', async () => {
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
          elementType: 'knob',
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          patch: { axisId: '  HIDA:raw  ' },
        },
      }),
    );

    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.patchElementProperty).toHaveBeenCalledWith(
      'knob',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      { axisId: '  HIDA:raw  ' },
      expect.objectContaining({ preflight: expect.any(Function) }),
    );
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'AUTHORITY_GENERATION_STALE' },
    });
  });

  it('statType은 stat-only exact property leaf로 전달한다', async () => {
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    mocks.requestListener?.(
      envelope('layers:patchProperty', {
        target: {
          elementType: 'stat',
          id,
          patch: { statType: 'kpsMax' },
        },
      }),
    );

    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.patchElementProperty).toHaveBeenCalledWith(
      'stat',
      id,
      { statType: 'kpsMax' },
      expect.objectContaining({ preflight: expect.any(Function) }),
    );
  });

  it.each([
    ['wrong type', 'graph', { statType: 'kps' }],
    ['wrong enum', 'stat', { statType: 'unknown' }],
    ['combined', 'stat', { statType: 'kps', hidden: true }],
  ])(
    'statType %s payload는 실행 전에 거절한다',
    async (_label, elementType, patch) => {
      mocks.requestListener?.(
        envelope('layers:patchProperty', {
          target: { elementType, id: 'stable', patch },
        }),
      );

      await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
      expect(mocks.patchElementProperty).not.toHaveBeenCalled();
      expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
        ok: false,
        error: { code: 'INVALID_PAYLOAD' },
      });
    },
  );

  it('native bounds는 exact 단일 축 descriptor를 main generator에 전달한다', async () => {
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const gestureId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    mocks.requestListener?.(
      envelope('layers:setBounds', {
        target: {
          elementType: 'stat',
          id,
          patch: { width: 140 },
          gestureId,
        },
      }),
    );

    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.commitElementGeometry).toHaveBeenCalledWith(
      'stat',
      id,
      { width: 140 },
      expect.objectContaining({
        gestureId,
        preflight: expect.any(Function),
      }),
    );
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({ ok: true });
  });

  it.each([
    [{ dx: 1, dy: 2 }],
    [{ width: 0 }],
    [{ height: Number.NaN }],
    [{ unknown: 1 }],
  ])('native bounds invalid patch %j는 실행 전에 거절한다', async (patch) => {
    mocks.requestListener?.(
      envelope('layers:setBounds', {
        target: {
          elementType: 'key',
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          patch,
        },
      }),
    );

    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.commitElementGeometry).not.toHaveBeenCalled();
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'INVALID_PAYLOAD' },
    });
  });

  it.each([['not-a-uuid'], ['a'.repeat(65)]])(
    'native bounds invalid gestureId %j는 실행 전에 거절한다',
    async (gestureId) => {
      mocks.requestListener?.(
        envelope('layers:setBounds', {
          target: {
            elementType: 'stat',
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            patch: { dx: 42 },
            gestureId,
          },
        }),
      );

      await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
      expect(mocks.commitElementGeometry).not.toHaveBeenCalled();
      expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
        ok: false,
        error: { code: 'INVALID_PAYLOAD' },
      });
    },
  );

  it('native bounds는 main 직렬 슬롯 진입 전에 generation을 다시 검사한다', async () => {
    const gestureId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    mocks.commitElementGeometry.mockImplementationOnce(
      async (_type, _id, _patch, options) => {
        mocks.authorityGeneration = 8;
        options?.preflight?.();
        return true;
      },
    );
    mocks.requestListener?.(
      envelope('layers:setBounds', {
        target: {
          elementType: 'stat',
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          patch: { dx: 42 },
          gestureId,
        },
      }),
    );

    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'AUTHORITY_GENERATION_STALE' },
    });
  });

  it('batch geometry는 high-level descriptor만 main generated helper에 전달한다', async () => {
    const gestureId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const descriptor = {
      mode: '4key',
      targets: [
        { type: 'key', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
        { type: 'stat', id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      ],
      operation: { kind: 'spacing', spacing: 2.3 },
    };
    mocks.requestListener?.(
      envelope('layers:setBatchGeometry', { descriptor, gestureId }),
    );

    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.commitBatchGeometry).toHaveBeenCalledWith(
      descriptor,
      expect.objectContaining({
        gestureId,
        preflight: expect.any(Function),
      }),
    );
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({ ok: true });
  });

  it('batch geometry helper의 false는 실행된 no-op 성공으로 응답한다', async () => {
    mocks.commitBatchGeometry.mockResolvedValueOnce(false);
    mocks.requestListener?.(
      envelope('layers:setBatchGeometry', {
        descriptor: {
          mode: '4key',
          targets: [
            { type: 'key', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
            { type: 'stat', id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
          ],
          operation: { kind: 'align', direction: 'left' },
        },
      }),
    );

    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.commitBatchGeometry).toHaveBeenCalledOnce();
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({ ok: true });
  });

  it('batch geometry 완료 전에 generation이 바뀌면 stale로 응답한다', async () => {
    let resolveCommit!: (value: boolean) => void;
    mocks.commitBatchGeometry.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCommit = resolve;
      }),
    );
    mocks.requestListener?.(
      envelope('layers:setBatchGeometry', {
        descriptor: {
          mode: '4key',
          targets: [
            { type: 'key', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
            { type: 'stat', id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
          ],
          operation: { kind: 'align', direction: 'left' },
        },
      }),
    );
    await vi.waitFor(() =>
      expect(mocks.commitBatchGeometry).toHaveBeenCalledOnce(),
    );
    mocks.authorityGeneration = 8;
    resolveCommit(true);

    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'AUTHORITY_GENERATION_STALE' },
    });
  });

  it.each([
    ['top extra', { extra: true }],
    ['raw bounds', { bounds: [] }],
    ['raw ops', { ops: [] }],
    ['index target', { targets: [{ type: 'key', id: 'a', index: 0 }] }],
    [
      'duplicate target',
      {
        targets: [
          { type: 'key', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
          { type: 'stat', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
        ],
      },
    ],
    ['synthetic target', { targets: [{ type: 'key', id: 'key-0' }] }],
    ['empty mode', { mode: '' }],
    ['oversize mode', { mode: '가'.repeat(43) }],
    ['empty targets', { targets: [] }],
    [
      'too many targets',
      {
        targets: Array.from({ length: 4097 }, (_, index) => ({
          type: 'key',
          id: `stable-${index}`,
        })),
      },
    ],
    ['bad operation', { operation: { kind: 'align', direction: 'middle' } }],
    [
      'operation nested extra',
      { operation: { kind: 'align', direction: 'left', extra: true } },
    ],
    [
      'resize nonpositive',
      { operation: { kind: 'resize', dimension: 'width', value: 0 } },
    ],
    [
      'resize nonfinite',
      { operation: { kind: 'resize', dimension: 'height', value: Number.NaN } },
    ],
    [
      'minimum align',
      {
        targets: [{ type: 'key', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }],
      },
    ],
    ['bad gesture', { gestureId: 'not-a-uuid' }],
    ['undefined gesture', { gestureId: undefined }],
  ])(
    'batch geometry %s payload는 실행 전에 거절한다',
    async (_label, override) => {
      const descriptor = {
        mode: '4key',
        targets: [
          { type: 'key', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
          { type: 'stat', id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
        ],
        operation: { kind: 'align', direction: 'left' },
        ...('mode' in override ? { mode: override.mode } : {}),
        ...('targets' in override ? { targets: override.targets } : {}),
        ...('operation' in override ? { operation: override.operation } : {}),
      };
      const payload = {
        descriptor,
        ...('gestureId' in override ? { gestureId: override.gestureId } : {}),
        ...('extra' in override ? { extra: override.extra } : {}),
        ...('bounds' in override ? { bounds: override.bounds } : {}),
        ...('ops' in override ? { ops: override.ops } : {}),
      };
      mocks.requestListener?.(envelope('layers:setBatchGeometry', payload));

      await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
      expect(mocks.commitBatchGeometry).not.toHaveBeenCalled();
      expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
        ok: false,
        error: { code: 'INVALID_PAYLOAD' },
      });
    },
  );

  it('batch geometry는 main 직렬 슬롯 진입 전에 generation을 다시 검사한다', async () => {
    mocks.commitBatchGeometry.mockImplementationOnce(
      async (_descriptor, options) => {
        mocks.authorityGeneration = 8;
        options?.preflight?.();
        return true;
      },
    );
    mocks.requestListener?.(
      envelope('layers:setBatchGeometry', {
        descriptor: {
          mode: '4key',
          targets: [
            { type: 'key', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
            { type: 'stat', id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
          ],
          operation: { kind: 'align', direction: 'left' },
        },
      }),
    );

    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'AUTHORITY_GENERATION_STALE' },
    });
  });

  it('group visibility는 exact descriptor와 slot preflight를 main helper에 전달한다', async () => {
    mocks.requestListener?.(
      envelope('layers:setGroupVisibility', {
        mode: '4key',
        groupId: 'group-a',
        hidden: true,
      }),
    );

    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.setLayerGroupHidden).toHaveBeenCalledWith(
      '4key',
      'group-a',
      true,
      { preflight: expect.any(Function) },
    );
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({ ok: true });
  });

  it.each([
    ['missing hidden', { mode: '4key', groupId: 'group-a' }],
    ['extra', { mode: '4key', groupId: 'group-a', hidden: true, extra: true }],
    ['bad mode', { mode: '', groupId: 'group-a', hidden: true }],
    ['long mode', { mode: '가'.repeat(43), groupId: 'group-a', hidden: true }],
    ['bad group', { mode: '4key', groupId: '', hidden: true }],
    ['long group', { mode: '4key', groupId: '가'.repeat(86), hidden: true }],
    ['bad hidden', { mode: '4key', groupId: 'group-a', hidden: 1 }],
  ])('group visibility %s payload를 거절한다', async (_label, payload) => {
    mocks.requestListener?.(envelope('layers:setGroupVisibility', payload));

    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.setLayerGroupHidden).not.toHaveBeenCalled();
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'INVALID_PAYLOAD' },
    });
  });

  it('group visibility는 slot 직전 generation 변경을 거절한다', async () => {
    mocks.setLayerGroupHidden.mockImplementationOnce(
      async (_mode, _groupId, _hidden, options) => {
        mocks.authorityGeneration = 8;
        options?.preflight?.();
        return true;
      },
    );
    mocks.requestListener?.(
      envelope('layers:setGroupVisibility', {
        mode: '4key',
        groupId: 'group-a',
        hidden: true,
      }),
    );

    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'AUTHORITY_GENERATION_STALE' },
    });
  });

  it('group visibility는 완료 전에 generation이 바뀌면 stale로 응답한다', async () => {
    let resolveGroup!: (value: boolean) => void;
    mocks.setLayerGroupHidden.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveGroup = resolve;
      }),
    );
    mocks.requestListener?.(
      envelope('layers:setGroupVisibility', {
        mode: '4key',
        groupId: 'group-a',
        hidden: true,
      }),
    );
    await vi.waitFor(() =>
      expect(mocks.setLayerGroupHidden).toHaveBeenCalledOnce(),
    );
    mocks.authorityGeneration = 8;
    resolveGroup(true);

    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'AUTHORITY_GENERATION_STALE' },
    });
  });

  it('group visibility unsupported false는 성공으로 숨기지 않는다', async () => {
    mocks.setLayerGroupHidden.mockResolvedValueOnce(false);
    mocks.requestListener?.(
      envelope('layers:setGroupVisibility', {
        mode: '4key',
        groupId: 'group-a',
        hidden: true,
      }),
    );

    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'PATCH_LAYER_PROPERTY_FAILED' },
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

  it('image fit은 main 직렬 슬롯 진입 전에 generation을 다시 검사한다', async () => {
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
          elementType: 'knob',
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          patch: { activeImageFit: 'contain' },
        },
      }),
    );

    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'AUTHORITY_GENERATION_STALE' },
    });
  });

  it('graphColor batch도 main 직렬 슬롯 진입 전에 generation을 다시 검사한다', async () => {
    mocks.patchGraphColors.mockImplementationOnce(
      async (_ids, _graphColor, options) => {
        mocks.authorityGeneration = 8;
        options?.preflight?.();
        return true;
      },
    );
    mocks.requestListener?.(
      envelope('layers:patchProperty', {
        targets: [{ elementType: 'graph', id: 'stable' }],
        patch: { graphColor: '#ffffff' },
      }),
    );

    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'AUTHORITY_GENERATION_STALE' },
    });
  });

  it('knob runtime batch도 main 직렬 슬롯 진입 전에 generation을 다시 검사한다', async () => {
    mocks.patchKnobProperties.mockImplementationOnce(
      async (_ids, _patch, options) => {
        mocks.authorityGeneration = 8;
        options?.preflight?.();
        return true;
      },
    );
    mocks.requestListener?.(
      envelope('layers:patchProperty', {
        targets: [{ elementType: 'knob', id: 'stable' }],
        patch: { reverse: true },
      }),
    );

    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'AUTHORITY_GENERATION_STALE' },
    });
  });

  it('인라인 스타일 혼합 batch도 main 직렬 슬롯 진입 전에 generation을 다시 검사한다', async () => {
    mocks.patchUseInlineStyles.mockImplementationOnce(
      async (_targets, _value, options) => {
        mocks.authorityGeneration = 8;
        options?.preflight?.();
        return true;
      },
    );
    mocks.requestListener?.(
      envelope('layers:patchProperty', {
        targets: [
          { elementType: 'key', id: 'stable-key' },
          { elementType: 'knob', id: 'stable-knob' },
        ],
        patch: { useInlineStyles: true },
      }),
    );

    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'AUTHORITY_GENERATION_STALE' },
    });
  });

  it('font style 혼합 batch도 main 직렬 슬롯 진입 전에 generation을 다시 검사한다', async () => {
    mocks.patchFontStyle.mockImplementationOnce(
      async (_targets, _patch, options) => {
        mocks.authorityGeneration = 8;
        options?.preflight?.();
        return true;
      },
    );
    mocks.requestListener?.(
      envelope('layers:patchProperty', {
        targets: [
          { elementType: 'key', id: 'stable-key' },
          { elementType: 'graph', id: 'stable-graph' },
        ],
        patch: { fontWeight: 700 },
      }),
    );

    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'AUTHORITY_GENERATION_STALE' },
    });
  });

  it('fontFamily 혼합 batch도 main 직렬 슬롯 진입 전에 generation을 다시 검사한다', async () => {
    mocks.patchFontFamily.mockImplementationOnce(
      async (_targets, _patch, options) => {
        mocks.authorityGeneration = 8;
        options?.preflight?.();
        return true;
      },
    );
    mocks.requestListener?.(
      envelope('layers:patchProperty', {
        targets: [
          { elementType: 'key', id: 'stable-key' },
          { elementType: 'graph', id: 'stable-graph' },
        ],
        patch: { fontFamily: '  Raw Family  ' },
      }),
    );

    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'AUTHORITY_GENERATION_STALE' },
    });
  });

  it('inactiveImage 혼합 batch도 main 직렬 슬롯 진입 전에 generation을 다시 검사한다', async () => {
    mocks.patchInactiveImage.mockImplementationOnce(
      async (_targets, _value, options) => {
        mocks.authorityGeneration = 8;
        options?.preflight?.();
        return true;
      },
    );
    mocks.requestListener?.(
      envelope('layers:patchProperty', {
        targets: [
          { elementType: 'key', id: 'stable-key' },
          { elementType: 'knob', id: 'stable-knob' },
        ],
        patch: { inactiveImage: '  Raw Image.png  ' },
      }),
    );

    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'AUTHORITY_GENERATION_STALE' },
    });
  });

  it('activeImage 혼합 batch도 main 직렬 슬롯 진입 전에 generation을 다시 검사한다', async () => {
    mocks.patchActiveImage.mockImplementationOnce(
      async (_targets, _value, options) => {
        mocks.authorityGeneration = 8;
        options?.preflight?.();
        return true;
      },
    );
    mocks.requestListener?.(
      envelope('layers:patchProperty', {
        targets: [
          { elementType: 'key', id: 'stable-key' },
          { elementType: 'knob', id: 'stable-knob' },
        ],
        patch: { activeImage: '  Raw Active.png  ' },
      }),
    );

    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'AUTHORITY_GENERATION_STALE' },
    });
  });

  it('displayText batch도 main 직렬 슬롯 진입 전에 generation을 다시 검사한다', async () => {
    mocks.patchDisplayText.mockImplementationOnce(
      async (_targets, _value, options) => {
        mocks.authorityGeneration = 8;
        options?.preflight?.();
        return true;
      },
    );
    mocks.requestListener?.(
      envelope('layers:patchProperty', {
        targets: [{ elementType: 'knob', id: 'stable-knob' }],
        patch: { displayText: 'Knob' },
        gestureId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      }),
    );

    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'AUTHORITY_GENERATION_STALE' },
    });
  });

  it('image transparency batch도 main 직렬 슬롯 진입 전에 generation을 다시 검사한다', async () => {
    mocks.patchIdleTransparent.mockImplementationOnce(
      async (_targets, _value, options) => {
        mocks.authorityGeneration = 8;
        options?.preflight?.();
        return true;
      },
    );
    mocks.requestListener?.(
      envelope('layers:patchProperty', {
        targets: [
          { elementType: 'key', id: 'stable-key' },
          { elementType: 'graph', id: 'stable-graph' },
        ],
        patch: { idleTransparent: true },
      }),
    );

    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'AUTHORITY_GENERATION_STALE' },
    });
  });

  it('soundPath batch도 main 직렬 슬롯 진입 전에 generation을 다시 검사한다', async () => {
    mocks.patchSoundPath.mockImplementationOnce(
      async (_ids, _value, options) => {
        mocks.authorityGeneration = 8;
        options?.preflight?.();
        return true;
      },
    );
    mocks.requestListener?.(
      envelope('layers:patchProperty', {
        targets: [{ elementType: 'key', id: 'stable-key' }],
        patch: { soundPath: '  sounds/raw.wav  ' },
      }),
    );

    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'AUTHORITY_GENERATION_STALE' },
    });
  });

  it('soundEnabled batch도 main 직렬 슬롯 진입 전에 generation을 다시 검사한다', async () => {
    mocks.patchSoundEnabled.mockImplementationOnce(
      async (_ids, _value, options) => {
        mocks.authorityGeneration = 8;
        options?.preflight?.();
        return true;
      },
    );
    mocks.requestListener?.(
      envelope('layers:patchProperty', {
        targets: [{ elementType: 'key', id: 'stable-key' }],
        patch: { soundEnabled: true },
      }),
    );

    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'AUTHORITY_GENERATION_STALE' },
    });
  });

  it('soundVolume batch도 main 직렬 슬롯 진입 전에 generation을 다시 검사한다', async () => {
    mocks.patchSoundVolume.mockImplementationOnce(
      async (_ids, _value, options) => {
        mocks.authorityGeneration = 8;
        options?.preflight?.();
        return true;
      },
    );
    mocks.requestListener?.(
      envelope('layers:patchProperty', {
        targets: [{ elementType: 'key', id: 'stable-key' }],
        patch: { soundVolume: 100 },
        gestureId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      }),
    );

    await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalledOnce());
    expect(mocks.respond.mock.calls[0]?.[1]).toMatchObject({
      ok: false,
      error: { code: 'AUTHORITY_GENERATION_STALE' },
    });
  });

  it('note batch도 main 직렬 슬롯 진입 전에 generation을 다시 검사한다', async () => {
    mocks.patchNoteProperties.mockImplementationOnce(
      async (_ids, _patch, options) => {
        mocks.authorityGeneration = 8;
        options?.preflight?.();
        return true;
      },
    );
    mocks.requestListener?.(
      envelope('layers:patchProperty', {
        targets: [{ elementType: 'key', id: 'stable-key' }],
        patch: { noteAlignment: 'right' },
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
