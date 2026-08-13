import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendPluginRpc: vi.fn(),
  sendBridgeMessageBestEffort: vi.fn(),
  updateElement: vi.fn(),
  setElements: vi.fn(),
  rotateEditSession: vi.fn(),
  authorityGeneration: 7,
  elements: [] as Array<{
    fullId: string;
    pluginId: string;
  }>,
}));

vi.mock('./pluginRpcClient', () => ({
  sendPluginRpc: mocks.sendPluginRpc,
  getPluginAuthorityGeneration: () => mocks.authorityGeneration,
}));

vi.mock('@utils/plugin/bridgeMessages', () => ({
  sendBridgeMessageBestEffort: mocks.sendBridgeMessageBestEffort,
}));

vi.mock('@utils/plugin/panelModelSync', () => ({
  PANEL_MODEL_REQUEST_MESSAGE: 'panel:model:request',
  getPluginPanelModelRevision: () => 0,
}));

vi.mock('@stores/plugin/usePluginDisplayElementStore', () => ({
  usePluginDisplayElementStore: {
    getState: () => ({
      elements: mocks.elements,
      setElements: mocks.setElements,
      updateElement: mocks.updateElement,
    }),
  },
}));

vi.mock('@plugins/runtime/displayElement/instancesCommitQueue', () => ({
  rotatePluginInstancesEditSession: mocks.rotateEditSession,
}));

describe('plugin element panel queue', () => {
  let actions: typeof import('./pluginElementActions');

  beforeEach(async () => {
    vi.resetModules();
    mocks.sendPluginRpc.mockReset();
    mocks.sendBridgeMessageBestEffort.mockReset();
    mocks.updateElement.mockReset();
    mocks.setElements.mockReset();
    mocks.rotateEditSession.mockReset();
    mocks.authorityGeneration = 7;
    mocks.elements = [];
    window.__dmn_window_type = 'panel';
    actions = await import('./pluginElementActions');
  });

  it('in-flight 뒤의 중첩 patch를 필드 단위로 병합하고 drain한다', async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    mocks.sendPluginRpc.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );

    actions.updatePluginElement('plugin:item', { position: { x: 100 } });
    actions.updatePluginElement('plugin:item', { position: { y: 200 } });
    actions.updatePluginElement('plugin:item', {
      settings: { accent: 'cyan' },
    });

    const drained = actions.drainPendingPluginElementWrites();
    expect(mocks.sendPluginRpc).toHaveBeenCalledTimes(1);

    resolvers[0]?.({ kind: 'ok', response: { modelRevision: 1 } });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(mocks.sendPluginRpc).toHaveBeenCalledTimes(2);
    expect(mocks.sendPluginRpc.mock.calls[1]?.[1]).toEqual({
      fullId: 'plugin:item',
      patch: {
        position: { y: 200 },
        settings: { accent: 'cyan' },
      },
    });

    resolvers[1]?.({ kind: 'ok', response: { modelRevision: 2 } });
    await expect(drained).resolves.toBe(true);
  });

  it('partial position, size, settings를 최신 authority 값에 병합한다', () => {
    const element = {
      id: 'item',
      fullId: 'plugin:item',
      pluginId: 'plugin',
      html: '<div />',
      position: { x: 10, y: 20 },
      measuredSize: { width: 120, height: 80 },
      settings: { accent: 'blue', opacity: 0.5 },
    } as Parameters<typeof actions.materializePluginElementUpdate>[0];

    expect(
      actions.materializePluginElementUpdate(element, {
        position: { y: 45 },
        measuredSize: { width: 240 },
        settings: { opacity: 0.8 },
      }),
    ).toMatchObject({
      position: { x: 10, y: 45 },
      measuredSize: { width: 240, height: 80 },
      settings: { accent: 'blue', opacity: 0.8 },
    });
  });

  it('레이어 삭제는 stable descriptor와 enqueue 시점 generation을 고정한다', async () => {
    mocks.sendPluginRpc.mockResolvedValue({
      kind: 'ok',
      response: { modelRevision: 1 },
    });

    await expect(
      actions.deleteLayerSelectionViaAuthority([
        {
          elementType: 'key',
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
        { elementType: 'plugin', id: 'plugin-a:one' },
      ]),
    ).resolves.toBe(true);

    expect(mocks.sendPluginRpc).toHaveBeenCalledWith(
      'layers:deleteSelection',
      {
        targets: [
          {
            elementType: 'key',
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          },
          { elementType: 'plugin', id: 'plugin-a:one' },
        ],
      },
      0,
      7,
    );
  });

  it.each([
    ['가시성', { hidden: true }],
    ['이름 clear', { layerName: null }],
    ['글꼴 패밀리', { fontFamily: '  Raw Family  ' }],
  ])(
    '%s literal과 enqueue 시점 generation을 고정한다',
    async (_label, patch) => {
      mocks.sendPluginRpc.mockResolvedValue({
        kind: 'ok',
        response: { modelRevision: 1 },
      });

      await expect(
        actions.patchNativeLayerPropertyViaAuthority({
          elementType: 'stat',
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          patch,
        }),
      ).resolves.toBe(true);

      expect(mocks.sendPluginRpc).toHaveBeenCalledWith(
        'layers:patchProperty',
        {
          target: {
            elementType: 'stat',
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            patch,
          },
        },
        0,
        7,
      );
    },
  );

  it('native bounds는 exact 단일 축과 enqueue generation을 고정한다', async () => {
    const gestureId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    mocks.sendPluginRpc.mockResolvedValue({
      kind: 'ok',
      response: { modelRevision: 1 },
    });

    await expect(
      actions.patchNativeLayerBoundsViaAuthority({
        elementType: 'key',
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        patch: { dx: 42 },
        gestureId,
      }),
    ).resolves.toBe(true);

    expect(mocks.sendPluginRpc).toHaveBeenCalledWith(
      'layers:setBounds',
      {
        target: {
          elementType: 'key',
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          patch: { dx: 42 },
          gestureId,
        },
      },
      0,
      7,
    );
  });

  it('native bounds outcome-unknown은 같은 generation과 축 literal로 한 번 재시도한다', async () => {
    mocks.sendPluginRpc
      .mockResolvedValueOnce({ kind: 'unknown' })
      .mockResolvedValueOnce({
        kind: 'ok',
        response: { modelRevision: 2 },
      });
    const changed = actions.patchNativeLayerBoundsViaAuthority({
      elementType: 'knob',
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      patch: { height: 150 },
    });
    await vi.waitFor(() =>
      expect(mocks.sendBridgeMessageBestEffort).toHaveBeenCalledOnce(),
    );
    actions.notePluginMirrorRevision(2);

    await expect(changed).resolves.toBe(true);
    expect(mocks.sendPluginRpc).toHaveBeenCalledTimes(2);
    expect(mocks.sendPluginRpc.mock.calls[1]?.[1]).toEqual(
      mocks.sendPluginRpc.mock.calls[0]?.[1],
    );
    expect(mocks.sendPluginRpc.mock.calls[1]?.[3]).toBe(7);
  });

  it('batch geometry는 high-level descriptor와 enqueue generation만 고정한다', async () => {
    mocks.sendPluginRpc.mockResolvedValue({
      kind: 'ok',
      response: { modelRevision: 1 },
    });
    const descriptor = {
      mode: '4key',
      targets: [
        {
          type: 'key' as const,
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
        {
          type: 'stat' as const,
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        },
      ],
      operation: { kind: 'align' as const, direction: 'left' as const },
    };

    await expect(
      actions.commitBatchGeometryViaAuthority(descriptor),
    ).resolves.toBe(true);

    expect(mocks.sendPluginRpc).toHaveBeenCalledWith(
      'layers:setBatchGeometry',
      { descriptor },
      0,
      7,
    );
  });

  it('batch geometry outcome-unknown은 snapshot만 요청하고 상대 intent를 재실행하지 않는다', async () => {
    mocks.sendPluginRpc.mockResolvedValueOnce({ kind: 'unknown' });

    await expect(
      actions.commitBatchGeometryViaAuthority({
        mode: '4key',
        targets: [
          { type: 'key', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
          { type: 'stat', id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
        ],
        operation: { kind: 'spacing', spacing: 2.3 },
      }),
    ).resolves.toBe(false);

    expect(mocks.sendPluginRpc).toHaveBeenCalledOnce();
    expect(mocks.sendBridgeMessageBestEffort).toHaveBeenCalledOnce();
  });

  it('group visibility는 high-level absolute descriptor와 enqueue generation만 보낸다', async () => {
    mocks.sendPluginRpc.mockResolvedValue({
      kind: 'ok',
      response: { modelRevision: 1 },
    });

    await expect(
      actions.setLayerGroupVisibilityViaAuthority('4key', 'group-a', true),
    ).resolves.toBe(true);

    expect(mocks.sendPluginRpc).toHaveBeenCalledWith(
      'layers:setGroupVisibility',
      { mode: '4key', groupId: 'group-a', hidden: true },
      0,
      7,
    );
  });

  it('group visibility outcome-unknown은 snapshot만 요청하고 재실행하지 않는다', async () => {
    mocks.sendPluginRpc.mockResolvedValueOnce({ kind: 'unknown' });

    await expect(
      actions.setLayerGroupVisibilityViaAuthority('4key', 'group-a', false),
    ).resolves.toBe(false);

    expect(mocks.sendPluginRpc).toHaveBeenCalledOnce();
    expect(mocks.sendBridgeMessageBestEffort).toHaveBeenCalledOnce();
  });

  it('fontFamily batch는 혼합 native 대상과 raw literal을 고정한다', async () => {
    mocks.sendPluginRpc.mockResolvedValue({
      kind: 'ok',
      response: { modelRevision: 1 },
    });
    const targets = [
      {
        elementType: 'key' as const,
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      {
        elementType: 'graph' as const,
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      },
    ];

    await expect(
      actions.patchFontFamilyViaAuthority(targets, {
        fontFamily: '  Raw Family  ',
      }),
    ).resolves.toBe(true);

    expect(mocks.sendPluginRpc).toHaveBeenCalledWith(
      'layers:patchProperty',
      { targets, patch: { fontFamily: '  Raw Family  ' } },
      0,
      7,
    );
  });

  it('인라인 스타일 batch는 혼합 native 대상과 공통 literal을 한 요청으로 고정한다', async () => {
    mocks.sendPluginRpc.mockResolvedValue({
      kind: 'ok',
      response: { modelRevision: 1 },
    });
    const targets = [
      {
        elementType: 'key' as const,
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      {
        elementType: 'knob' as const,
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      },
    ];

    await expect(
      actions.patchUseInlineStylesViaAuthority(targets, true),
    ).resolves.toBe(true);

    expect(mocks.sendPluginRpc).toHaveBeenCalledWith(
      'layers:patchProperty',
      { targets, patch: { useInlineStyles: true } },
      0,
      7,
    );
  });

  it.each([
    [{ fontWeight: 700 }],
    [{ fontItalic: true }],
    [{ fontUnderline: false }],
    [{ fontStrikethrough: true }],
  ] as const)(
    'font style batch %j는 혼합 native 대상과 absolute literal을 고정한다',
    async (patch) => {
      mocks.sendPluginRpc.mockResolvedValue({
        kind: 'ok',
        response: { modelRevision: 1 },
      });
      const targets = [
        {
          elementType: 'key' as const,
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
        {
          elementType: 'graph' as const,
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        },
      ];

      await expect(
        actions.patchFontStyleViaAuthority(targets, patch),
      ).resolves.toBe(true);

      expect(mocks.sendPluginRpc).toHaveBeenCalledWith(
        'layers:patchProperty',
        { targets, patch },
        0,
        7,
      );
    },
  );

  it.each([
    [{ noteEffectEnabled: false }],
    [{ noteAutoYCorrection: true }],
    [{ noteGlowEnabled: false }],
    [{ noteAlignment: 'right' }],
    [{ noteBorderSide: 'horizontal' }],
  ] as const)(
    'note batch %j는 key ID와 absolute literal을 한 요청으로 고정한다',
    async (patch) => {
      mocks.sendPluginRpc.mockResolvedValue({
        kind: 'ok',
        response: { modelRevision: 1 },
      });
      const ids = [
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      ];

      await expect(
        actions.patchNotePropertiesViaAuthority(ids, patch),
      ).resolves.toBe(true);

      expect(mocks.sendPluginRpc).toHaveBeenCalledWith(
        'layers:patchProperty',
        {
          targets: ids.map((id) => ({ elementType: 'key', id })),
          patch,
        },
        0,
        7,
      );
    },
  );

  it('인라인 스타일 batch 재시도는 같은 generation과 absolute literal을 보존한다', async () => {
    mocks.sendPluginRpc
      .mockResolvedValueOnce({ kind: 'unknown' })
      .mockResolvedValueOnce({
        kind: 'ok',
        response: { modelRevision: 2 },
      });
    const changed = actions.patchUseInlineStylesViaAuthority(
      [
        {
          elementType: 'stat',
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
      ],
      false,
    );
    await vi.waitFor(() =>
      expect(mocks.sendBridgeMessageBestEffort).toHaveBeenCalledOnce(),
    );
    actions.notePluginMirrorRevision(2);

    await expect(changed).resolves.toBe(true);
    expect(mocks.sendPluginRpc).toHaveBeenCalledTimes(2);
    expect(mocks.sendPluginRpc.mock.calls[1]?.[1]).toEqual(
      mocks.sendPluginRpc.mock.calls[0]?.[1],
    );
    expect(mocks.sendPluginRpc.mock.calls[1]?.[3]).toBe(7);
  });

  it('font style batch outcome-unknown 재시도는 같은 generation과 absolute literal을 한 번만 재전송한다', async () => {
    mocks.sendPluginRpc
      .mockResolvedValueOnce({ kind: 'unknown' })
      .mockResolvedValueOnce({
        kind: 'ok',
        response: { modelRevision: 2 },
      });
    const changed = actions.patchFontStyleViaAuthority(
      [
        {
          elementType: 'key',
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
        {
          elementType: 'knob',
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        },
      ],
      { fontWeight: 700 },
    );
    await vi.waitFor(() =>
      expect(mocks.sendBridgeMessageBestEffort).toHaveBeenCalledOnce(),
    );
    actions.notePluginMirrorRevision(2);

    await expect(changed).resolves.toBe(true);
    expect(mocks.sendPluginRpc).toHaveBeenCalledTimes(2);
    expect(mocks.sendPluginRpc.mock.calls[1]?.[1]).toEqual(
      mocks.sendPluginRpc.mock.calls[0]?.[1],
    );
    expect(mocks.sendPluginRpc.mock.calls[1]?.[3]).toBe(7);
  });

  it('fontFamily batch outcome-unknown 재시도는 같은 generation과 raw literal을 한 번만 재전송한다', async () => {
    mocks.sendPluginRpc
      .mockResolvedValueOnce({ kind: 'unknown' })
      .mockResolvedValueOnce({
        kind: 'ok',
        response: { modelRevision: 2 },
      });
    const changed = actions.patchFontFamilyViaAuthority(
      [
        {
          elementType: 'key',
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
        {
          elementType: 'knob',
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        },
      ],
      { fontFamily: '  Raw Family  ' },
    );
    await vi.waitFor(() =>
      expect(mocks.sendBridgeMessageBestEffort).toHaveBeenCalledOnce(),
    );
    actions.notePluginMirrorRevision(2);

    await expect(changed).resolves.toBe(true);
    expect(mocks.sendPluginRpc).toHaveBeenCalledTimes(2);
    expect(mocks.sendPluginRpc.mock.calls[1]?.[1]).toEqual(
      mocks.sendPluginRpc.mock.calls[0]?.[1],
    );
    expect(mocks.sendPluginRpc.mock.calls[1]?.[3]).toBe(7);
  });

  it('note batch outcome-unknown 재시도는 같은 generation과 absolute literal을 한 번만 재전송한다', async () => {
    mocks.sendPluginRpc
      .mockResolvedValueOnce({ kind: 'unknown' })
      .mockResolvedValueOnce({
        kind: 'ok',
        response: { modelRevision: 2 },
      });
    const changed = actions.patchNotePropertiesViaAuthority(
      ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
      { noteBorderSide: 'all' },
    );
    await vi.waitFor(() =>
      expect(mocks.sendBridgeMessageBestEffort).toHaveBeenCalledOnce(),
    );
    actions.notePluginMirrorRevision(2);

    await expect(changed).resolves.toBe(true);
    expect(mocks.sendPluginRpc).toHaveBeenCalledTimes(2);
    expect(mocks.sendPluginRpc.mock.calls[1]?.[1]).toEqual(
      mocks.sendPluginRpc.mock.calls[0]?.[1],
    );
    expect(mocks.sendPluginRpc.mock.calls[1]?.[3]).toBe(7);
  });

  it('graphType batch는 공통 literal과 안정 ID 배열을 한 요청으로 고정한다', async () => {
    mocks.sendPluginRpc.mockResolvedValue({
      kind: 'ok',
      response: { modelRevision: 1 },
    });

    await expect(
      actions.patchGraphTypesViaAuthority(
        [
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        ],
        'bar',
      ),
    ).resolves.toBe(true);

    expect(mocks.sendPluginRpc).toHaveBeenCalledWith(
      'layers:patchProperty',
      {
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
        patch: { graphType: 'bar' },
      },
      0,
      7,
    );
  });

  it('graphType batch outcome-unknown은 같은 generation에서 literal 그대로 한 번 재시도한다', async () => {
    mocks.sendPluginRpc
      .mockResolvedValueOnce({ kind: 'unknown' })
      .mockResolvedValueOnce({
        kind: 'ok',
        response: { modelRevision: 2 },
      });
    const changed = actions.patchGraphTypesViaAuthority(
      ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
      'bar',
    );
    await vi.waitFor(() =>
      expect(mocks.sendBridgeMessageBestEffort).toHaveBeenCalledOnce(),
    );
    actions.notePluginMirrorRevision(2);

    await expect(changed).resolves.toBe(true);
    expect(mocks.sendPluginRpc).toHaveBeenCalledTimes(2);
    expect(mocks.sendPluginRpc.mock.calls[1]?.[1]).toEqual(
      mocks.sendPluginRpc.mock.calls[0]?.[1],
    );
    expect(mocks.sendPluginRpc.mock.calls[1]?.[3]).toBe(7);
  });

  it('graphColor batch는 공통 literal과 안정 ID 배열을 한 요청으로 고정한다', async () => {
    mocks.sendPluginRpc.mockResolvedValue({
      kind: 'ok',
      response: { modelRevision: 1 },
    });

    await expect(
      actions.patchGraphColorsViaAuthority(
        [
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        ],
        '#12abEF',
      ),
    ).resolves.toBe(true);

    expect(mocks.sendPluginRpc).toHaveBeenCalledWith(
      'layers:patchProperty',
      {
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
      },
      0,
      7,
    );
  });

  it.each([
    ['graph', { showAvgLine: false }],
    ['graph', { graphAnimationEnabled: true }],
    ['graph', { graphSpeed: 1200 }],
    ['knob', { sensitivity: 1.25 }],
    ['knob', { reverse: true }],
  ] as const)(
    '%s runtime batch는 absolute literal과 안정 ID 배열을 한 요청으로 고정한다',
    async (elementType, patch) => {
      mocks.sendPluginRpc.mockResolvedValue({
        kind: 'ok',
        response: { modelRevision: 1 },
      });
      const ids = [
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      ];

      const request =
        elementType === 'graph'
          ? actions.patchGraphPropertiesViaAuthority(ids, patch)
          : actions.patchKnobPropertiesViaAuthority(ids, patch);
      await expect(request).resolves.toBe(true);

      expect(mocks.sendPluginRpc).toHaveBeenCalledWith(
        'layers:patchProperty',
        {
          targets: ids.map((id) => ({ elementType, id })),
          patch,
        },
        0,
        7,
      );
    },
  );

  it('toggle batch outcome-unknown은 같은 generation에서 absolute literal 그대로 재시도한다', async () => {
    mocks.sendPluginRpc
      .mockResolvedValueOnce({ kind: 'unknown' })
      .mockResolvedValueOnce({
        kind: 'ok',
        response: { modelRevision: 2 },
      });
    const changed = actions.patchKnobPropertiesViaAuthority(
      ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
      { reverse: true },
    );
    await vi.waitFor(() =>
      expect(mocks.sendBridgeMessageBestEffort).toHaveBeenCalledOnce(),
    );
    actions.notePluginMirrorRevision(2);

    await expect(changed).resolves.toBe(true);
    expect(mocks.sendPluginRpc).toHaveBeenCalledTimes(2);
    expect(mocks.sendPluginRpc.mock.calls[1]?.[1]).toEqual(
      mocks.sendPluginRpc.mock.calls[0]?.[1],
    );
    expect(mocks.sendPluginRpc.mock.calls[1]?.[3]).toBe(7);
  });

  it.each([
    { kind: 'unknown' },
    { kind: 'error', errorCode: 'MODEL_REVISION_STALE' },
  ])(
    '같은 generation의 가시성 $kind은 snapshot 뒤 한 번 재시도한다',
    async (first) => {
      mocks.sendPluginRpc.mockResolvedValueOnce(first).mockResolvedValueOnce({
        kind: 'ok',
        response: { modelRevision: 2 },
      });
      const changed = actions.patchNativeLayerPropertyViaAuthority({
        elementType: 'key',
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        patch: { layerName: 'renamed' },
      });
      await vi.waitFor(() =>
        expect(mocks.sendBridgeMessageBestEffort).toHaveBeenCalledOnce(),
      );
      actions.notePluginMirrorRevision(2);

      await expect(changed).resolves.toBe(true);
      expect(mocks.sendPluginRpc).toHaveBeenCalledTimes(2);
      expect(mocks.sendPluginRpc.mock.calls[1]?.[1]).toEqual(
        mocks.sendPluginRpc.mock.calls[0]?.[1],
      );
      expect(mocks.sendPluginRpc.mock.calls[1]?.[2]).toBe(2);
      expect(mocks.sendPluginRpc.mock.calls[1]?.[3]).toBe(7);
    },
  );

  it.each([
    { kind: 'unknown' },
    {
      kind: 'error',
      errorCode: 'MODEL_REVISION_STALE',
      response: { modelRevision: 1 },
    },
  ])(
    '같은 generation의 $kind 삭제는 snapshot 뒤 한 번만 재시도한다',
    async (first) => {
      mocks.sendPluginRpc.mockResolvedValueOnce(first).mockResolvedValueOnce({
        kind: 'ok',
        response: { modelRevision: 2 },
      });

      const deleted = actions.deleteLayerSelectionViaAuthority([
        { elementType: 'plugin', id: 'plugin-a:one' },
      ]);
      await vi.waitFor(() =>
        expect(mocks.sendBridgeMessageBestEffort).toHaveBeenCalledOnce(),
      );
      actions.notePluginMirrorRevision(2);

      await expect(deleted).resolves.toBe(true);
      expect(mocks.sendPluginRpc).toHaveBeenCalledTimes(2);
      expect(mocks.sendPluginRpc.mock.calls[1]?.[0]).toBe(
        mocks.sendPluginRpc.mock.calls[0]?.[0],
      );
      expect(mocks.sendPluginRpc.mock.calls[1]?.[1]).toEqual(
        mocks.sendPluginRpc.mock.calls[0]?.[1],
      );
      expect(mocks.sendPluginRpc.mock.calls[1]?.[2]).toBe(2);
      expect(mocks.sendPluginRpc.mock.calls[1]?.[3]).toBe(7);
    },
  );

  it('snapshot 대기 중 generation이 바뀌면 삭제를 재시도하지 않는다', async () => {
    mocks.sendPluginRpc.mockResolvedValueOnce({ kind: 'unknown' });

    const deleted = actions.deleteLayerSelectionViaAuthority([
      { elementType: 'plugin', id: 'plugin-a:one' },
    ]);
    await vi.waitFor(() =>
      expect(mocks.sendBridgeMessageBestEffort).toHaveBeenCalledOnce(),
    );
    mocks.authorityGeneration = 8;
    actions.notePluginMirrorRevision(1);

    await expect(deleted).resolves.toBe(false);
    expect(mocks.sendPluginRpc).toHaveBeenCalledOnce();
  });

  it.each([
    { kind: 'unknown' },
    { kind: 'error', errorCode: 'MODEL_REVISION_STALE' },
  ])('레이어 재정렬 $kind 결과는 자동 재실행하지 않는다', async (outcome) => {
    mocks.sendPluginRpc.mockResolvedValueOnce(outcome);
    const descriptor: import('./pluginElementActions').LayerReorderIntentWire =
      {
        kind: 'items',
        mode: '4key',
        draggedIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
        collapsedGroupIds: ['group-collapsed'],
        anchors: {
          toDisplayIndex: 2,
          targetGroupId: null,
          anchorBeforeId: null,
          anchorAfterId: null,
          anchorHeaderGroupId: null,
          anchorBeforeHeaderGroupId: null,
          anchorAfterHeaderGroupId: null,
          boundary: 'bottom',
        },
        preserveFullGroups: false,
      };

    await expect(
      actions.reorderLayerSelectionViaAuthority(descriptor),
    ).resolves.toBe(false);

    expect(mocks.sendPluginRpc).toHaveBeenCalledOnce();
    expect(mocks.sendPluginRpc).toHaveBeenCalledWith(
      'layers:reorderSelection',
      { descriptor },
      expect.any(Number),
      7,
    );
    expect(mocks.sendBridgeMessageBestEffort).toHaveBeenCalledOnce();
  });

  it('main의 discrete 삭제는 대상 플러그인별 세션을 먼저 분리한다', () => {
    window.__dmn_window_type = 'main';
    mocks.elements = [
      { fullId: 'plugin-a:one', pluginId: 'plugin-a' },
      { fullId: 'plugin-a:two', pluginId: 'plugin-a' },
      { fullId: 'plugin-b:one', pluginId: 'plugin-b' },
      { fullId: 'plugin-c:one', pluginId: 'plugin-c' },
    ];

    actions.deletePluginElements([
      'plugin-a:one',
      'plugin-a:two',
      'plugin-b:one',
    ]);

    expect(mocks.rotateEditSession).toHaveBeenCalledTimes(2);
    expect(mocks.rotateEditSession).toHaveBeenCalledWith('plugin-a');
    expect(mocks.rotateEditSession).toHaveBeenCalledWith('plugin-b');
    expect(mocks.setElements).toHaveBeenCalledWith([
      { fullId: 'plugin-c:one', pluginId: 'plugin-c' },
    ]);
  });

  it('main의 가시성 변경은 대상 플러그인별 세션을 먼저 분리한다', () => {
    window.__dmn_window_type = 'main';
    mocks.elements = [
      { fullId: 'plugin-a:one', pluginId: 'plugin-a' },
      { fullId: 'plugin-a:two', pluginId: 'plugin-a' },
      { fullId: 'plugin-b:one', pluginId: 'plugin-b' },
    ];

    actions.setPluginElementsHidden([
      { fullId: 'plugin-a:one', hidden: true },
      { fullId: 'plugin-a:two', hidden: true },
      { fullId: 'plugin-b:one', hidden: false },
    ]);

    expect(mocks.rotateEditSession).toHaveBeenCalledTimes(2);
    expect(mocks.rotateEditSession).toHaveBeenCalledWith('plugin-a');
    expect(mocks.rotateEditSession).toHaveBeenCalledWith('plugin-b');
    expect(mocks.rotateEditSession.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.updateElement.mock.invocationCallOrder[0]!,
    );
    expect(mocks.updateElement).toHaveBeenCalledTimes(3);
  });

  it('main의 레이어 순서 변경은 대상 플러그인별 세션을 먼저 분리한다', () => {
    window.__dmn_window_type = 'main';
    mocks.elements = [
      { fullId: 'plugin-a:one', pluginId: 'plugin-a' },
      { fullId: 'plugin-b:one', pluginId: 'plugin-b' },
    ];

    actions.setPluginElementZIndexes([
      { fullId: 'plugin-a:one', zIndex: 10 },
      { fullId: 'plugin-b:one', zIndex: 9 },
    ]);

    expect(mocks.rotateEditSession).toHaveBeenCalledTimes(2);
    expect(mocks.rotateEditSession).toHaveBeenCalledWith('plugin-a');
    expect(mocks.rotateEditSession).toHaveBeenCalledWith('plugin-b');
    expect(mocks.rotateEditSession.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.updateElement.mock.invocationCallOrder[0]!,
    );
    expect(mocks.updateElement).toHaveBeenCalledTimes(2);
  });
});
