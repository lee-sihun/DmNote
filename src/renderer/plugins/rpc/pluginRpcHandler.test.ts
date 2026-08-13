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
  patchNoteProperties: vi.fn(
    (_ids?: unknown, _patch?: unknown, _options?: { preflight?: () => void }) =>
      Promise.resolve(true),
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
  patchGraphPropertiesByIds: mocks.patchGraphProperties,
  patchGraphTypesByIds: mocks.patchGraphTypes,
  patchKnobPropertiesByIds: mocks.patchKnobProperties,
  patchNotePropertiesByIds: mocks.patchNoteProperties,
  patchUseInlineStylesByTargets: mocks.patchUseInlineStyles,
  setLayerGroupHidden: mocks.setLayerGroupHidden,
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
    ['가시성', { hidden: true }, 'graph'],
    ['이름', { layerName: 'renamed' }],
    ['이름 clear', { layerName: null }],
    ['그래프 타입', { graphType: 'bar' }],
    ['그래프 색상', { graphColor: '#12abEF' }],
    ['평균선', { showAvgLine: false }],
    ['그래프 애니메이션', { graphAnimationEnabled: true }],
    ['그래프 속도', { graphSpeed: 1200 }],
    ['노브 축', { axisId: '  HIDA:raw  ' }, 'knob'],
    ['인라인 스타일', { useInlineStyles: true }],
    ['글꼴 굵기', { fontWeight: 700 }],
    ['글꼴 기울임', { fontItalic: true }],
    ['글꼴 밑줄', { fontUnderline: false }],
    ['글꼴 취소선', { fontStrikethrough: true }],
    ['글꼴 패밀리', { fontFamily: '  Raw Family  ' }],
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
      expect(mocks.patchNoteProperties).not.toHaveBeenCalled();
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
