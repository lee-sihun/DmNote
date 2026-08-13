import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorPreviewStylePropertyPatchV1 } from '@src/types/editor';
import type {
  EditorCounterLayoutPropertyPatchV1,
  EditorCounterStrokePropertyPatchV1,
  EditorCounterTypographyPropertyPatchV1,
} from '@src/types/editor';

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
    ['가시성', { hidden: true }, 'stat'],
    ['이름 clear', { layerName: null }, 'stat'],
    ['글꼴 패밀리', { fontFamily: '  Raw Family  ' }, 'stat'],
    ['노브 축', { axisId: '  HIDA:raw  ' }, 'knob'],
    ['사운드', { soundPath: '  sounds/raw.wav  ' }, 'key'],
    ['대기 이미지', { inactiveImage: '  Raw Image.png  ' }, 'graph'],
    ['활성 이미지', { activeImage: '  Raw Active.png  ' }, 'key'],
    ['대기 이미지 맞춤', { idleImageFit: 'contain' }, 'graph'],
    ['활성 이미지 맞춤', { activeImageFit: 'fill' }, 'knob'],
  ] as const)(
    '%s literal과 enqueue 시점 generation을 고정한다',
    async (_label, patch, elementType) => {
      mocks.sendPluginRpc.mockResolvedValue({
        kind: 'ok',
        response: { modelRevision: 1 },
      });

      await expect(
        actions.patchNativeLayerPropertyViaAuthority({
          elementType,
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          patch,
        }),
      ).resolves.toBe(true);

      expect(mocks.sendPluginRpc).toHaveBeenCalledWith(
        'layers:patchProperty',
        {
          target: {
            elementType,
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            patch,
          },
        },
        0,
        7,
      );
    },
  );

  it('noteGlowSize batch는 key-only exact literal을 gesture 없이 공용 envelope로 보낸다', async () => {
    mocks.sendPluginRpc.mockResolvedValueOnce({
      kind: 'ok',
      response: { modelRevision: 1 },
    });
    const targets = [
      {
        elementType: 'key' as const,
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
    ];

    await expect(
      actions.patchStylePropertyViaAuthority(targets, { noteGlowSize: 20.5 }),
    ).resolves.toBe(true);
    expect(mocks.sendPluginRpc).toHaveBeenCalledWith(
      'layers:patchProperty',
      { targets, patch: { noteGlowSize: 20.5 } },
      0,
      7,
    );
  });

  it.each([
    { noteOffsetX: 0 },
    { noteOffsetY: null },
    { noteWidth: null },
    { noteBorderWidth: 2.5 },
    { noteBorderRadius: 12.5 },
  ] satisfies readonly EditorPreviewStylePropertyPatchV1[])(
    'note numeric %j batch는 key-only exact literal을 공용 envelope로 보낸다',
    async (patch) => {
      mocks.sendPluginRpc.mockResolvedValueOnce({
        kind: 'ok',
        response: { modelRevision: 1 },
      });
      const targets = [
        {
          elementType: 'key' as const,
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
      ];

      await expect(
        actions.patchStylePropertyViaAuthority(
          targets,
          patch as EditorPreviewStylePropertyPatchV1,
        ),
      ).resolves.toBe(true);
      expect(mocks.sendPluginRpc).toHaveBeenCalledWith(
        'layers:patchProperty',
        { targets, patch },
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

  it('displayText batch는 common targets, raw literal, gesture를 default envelope에 고정한다', async () => {
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
      actions.patchStylePropertyViaAuthority(
        targets,
        { displayText: '  Raw label  ' },
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      ),
    ).resolves.toBe(true);

    expect(mocks.sendPluginRpc).toHaveBeenCalledWith(
      'layers:patchProperty',
      {
        targets,
        patch: { displayText: '  Raw label  ' },
        gestureId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      },
      0,
      7,
    );
  });

  it('className batch도 공용 text envelope와 default retry를 사용한다', async () => {
    mocks.sendPluginRpc.mockResolvedValueOnce({
      kind: 'ok',
      response: { modelRevision: 1 },
    });
    const targets = [
      {
        elementType: 'knob' as const,
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
    ];

    await expect(
      actions.patchStylePropertyViaAuthority(
        targets,
        { className: '  Raw class  ' },
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      ),
    ).resolves.toBe(true);

    expect(mocks.sendPluginRpc).toHaveBeenCalledWith(
      'layers:patchProperty',
      {
        targets,
        patch: { className: '  Raw class  ' },
        gestureId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      },
      0,
      7,
    );
  });

  it.each([
    ['borderWidth', { borderWidth: 12.5 }],
    ['borderRadius', { borderRadius: 999 }],
    ['fontSize', { fontSize: 31.5 }],
  ] as const)(
    '%s batch도 공용 style envelope와 gesture를 사용한다',
    async (_label, patch) => {
      mocks.sendPluginRpc.mockResolvedValueOnce({
        kind: 'ok',
        response: { modelRevision: 1 },
      });
      const targets = [
        {
          elementType: 'knob' as const,
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
      ];

      await expect(
        actions.patchStylePropertyViaAuthority(
          targets,
          patch,
          'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        ),
      ).resolves.toBe(true);

      expect(mocks.sendPluginRpc).toHaveBeenCalledWith(
        'layers:patchProperty',
        {
          targets,
          patch,
          gestureId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        },
        0,
        7,
      );
    },
  );

  it('inactiveImage batch는 혼합 native 대상과 raw literal을 고정한다', async () => {
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
      actions.patchInactiveImageViaAuthority(targets, '  Raw Image.png  '),
    ).resolves.toBe(true);

    expect(mocks.sendPluginRpc).toHaveBeenCalledWith(
      'layers:patchProperty',
      { targets, patch: { inactiveImage: '  Raw Image.png  ' } },
      0,
      7,
    );
  });

  it('activeImage batch는 key와 knob 대상 및 raw literal을 고정한다', async () => {
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
      actions.patchActiveImageViaAuthority(targets, '  Raw Active.png  '),
    ).resolves.toBe(true);

    expect(mocks.sendPluginRpc).toHaveBeenCalledWith(
      'layers:patchProperty',
      { targets, patch: { activeImage: '  Raw Active.png  ' } },
      0,
      7,
    );
  });

  it.each([
    ['idle', 'patchIdleTransparentViaAuthority', { idleTransparent: true }],
    [
      'active',
      'patchActiveTransparentViaAuthority',
      { activeTransparent: false },
    ],
  ] as const)(
    '%s transparency batch는 exact bool과 default envelope를 고정한다',
    async (_label, method, patch) => {
      mocks.sendPluginRpc.mockResolvedValue({
        kind: 'ok',
        response: { modelRevision: 1 },
      });
      const targets = [
        {
          elementType: 'key' as const,
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
      ];

      await expect(
        actions[method](targets, Object.values(patch)[0]),
      ).resolves.toBe(true);
      expect(mocks.sendPluginRpc).toHaveBeenCalledWith(
        'layers:patchProperty',
        { targets, patch },
        0,
        7,
      );
    },
  );

  it('soundPath batch는 key 대상과 raw literal을 전용 envelope에 고정한다', async () => {
    mocks.sendPluginRpc.mockResolvedValue({
      kind: 'ok',
      response: { modelRevision: 1 },
    });
    const ids = [
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    ];

    await expect(
      actions.patchSoundPathViaAuthority(ids, '  sounds/raw.wav  '),
    ).resolves.toBe(true);

    expect(mocks.sendPluginRpc).toHaveBeenCalledWith(
      'layers:patchProperty',
      {
        targets: ids.map((id) => ({ elementType: 'key', id })),
        patch: { soundPath: '  sounds/raw.wav  ' },
      },
      0,
      7,
    );
  });

  it('soundEnabled batch는 key 대상과 absolute bool을 staleOnly envelope에 고정한다', async () => {
    mocks.sendPluginRpc.mockResolvedValue({
      kind: 'ok',
      response: { modelRevision: 1 },
    });
    const ids = [
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    ];

    await expect(
      actions.patchSoundEnabledViaAuthority(ids, true),
    ).resolves.toBe(true);

    expect(mocks.sendPluginRpc).toHaveBeenCalledWith(
      'layers:patchProperty',
      {
        targets: ids.map((id) => ({ elementType: 'key', id })),
        patch: { soundEnabled: true },
      },
      0,
      7,
    );
  });

  it('soundVolume batch는 key 대상, absolute number, gesture를 default envelope에 고정한다', async () => {
    mocks.sendPluginRpc.mockResolvedValue({
      kind: 'ok',
      response: { modelRevision: 1 },
    });
    const ids = [
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    ];

    await expect(
      actions.patchSoundVolumeViaAuthority(
        ids,
        137.5,
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      ),
    ).resolves.toBe(true);

    expect(mocks.sendPluginRpc).toHaveBeenCalledWith(
      'layers:patchProperty',
      {
        targets: ids.map((id) => ({ elementType: 'key', id })),
        patch: { soundVolume: 137.5 },
        gestureId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      },
      0,
      7,
    );
  });

  it('counter animation preset batch는 exact nested intent를 staleOnly envelope로 보낸다', async () => {
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
        elementType: 'stat' as const,
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      },
    ];
    const intent = { presetId: 'preset-a', scale: 1.4 };

    await expect(
      actions.patchCounterAnimationPresetViaAuthority(targets, intent),
    ).resolves.toBe(true);
    expect(mocks.sendPluginRpc).toHaveBeenCalledWith(
      'layers:patchProperty',
      { targets, patch: { counterAnimationPreset: intent } },
      0,
      7,
    );
  });

  it('counter bool 두 batch는 exact key/stat target과 default envelope를 보낸다', async () => {
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
        elementType: 'stat' as const,
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      },
    ];

    await expect(
      actions.patchCounterEnabledViaAuthority(targets, false),
    ).resolves.toBe(true);
    await expect(
      actions.patchCounterAnimationEnabledViaAuthority(targets, true),
    ).resolves.toBe(true);
    expect(mocks.sendPluginRpc.mock.calls[0]?.slice(0, 2)).toEqual([
      'layers:patchProperty',
      { targets, patch: { counterEnabled: false } },
    ]);
    expect(mocks.sendPluginRpc.mock.calls[1]?.slice(0, 2)).toEqual([
      'layers:patchProperty',
      { targets, patch: { counterAnimationEnabled: true } },
    ]);
  });

  it('counter bool outcome-unknown은 same literal default retry를 한 번만 한다', async () => {
    mocks.sendPluginRpc
      .mockResolvedValueOnce({ kind: 'unknown' })
      .mockResolvedValueOnce({
        kind: 'ok',
        response: { modelRevision: 1 },
      });
    const pending = actions.patchCounterEnabledViaAuthority(
      [
        {
          elementType: 'key',
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
      ],
      false,
    );
    await vi.waitFor(() =>
      expect(mocks.sendBridgeMessageBestEffort).toHaveBeenCalledOnce(),
    );
    actions.notePluginMirrorRevision(1);
    await expect(pending).resolves.toBe(true);
    expect(mocks.sendPluginRpc).toHaveBeenCalledTimes(2);
    expect(mocks.sendPluginRpc.mock.calls[1]?.[1]).toEqual(
      mocks.sendPluginRpc.mock.calls[0]?.[1],
    );
  });

  it('counter bool snapshot 대기 중 generation 변경은 재전송하지 않는다', async () => {
    mocks.sendPluginRpc.mockResolvedValueOnce({ kind: 'unknown' });
    const pending = actions.patchCounterAnimationEnabledViaAuthority(
      [
        {
          elementType: 'stat',
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        },
      ],
      true,
    );
    await vi.waitFor(() =>
      expect(mocks.sendBridgeMessageBestEffort).toHaveBeenCalledOnce(),
    );
    mocks.authorityGeneration = 8;
    actions.notePluginMirrorRevision(1);
    await expect(pending).resolves.toBe(false);
    expect(mocks.sendPluginRpc).toHaveBeenCalledOnce();
  });

  it('counter layout 4 batch는 exact key/stat target과 default envelope를 보낸다', async () => {
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
        elementType: 'stat' as const,
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      },
    ];
    const patches: EditorCounterLayoutPropertyPatchV1[] = [
      { counterPlacement: 'outside' as const },
      { counterAlign: 'right' as const },
      { counterAlignMode: 'between' as const },
      { counterGap: 4_294_967_295 },
    ];

    for (const patch of patches) {
      await expect(
        actions.patchCounterLayoutViaAuthority(targets, patch),
      ).resolves.toBe(true);
    }
    expect(
      mocks.sendPluginRpc.mock.calls.map((call) => call.slice(0, 2)),
    ).toEqual(
      patches.map((patch) => ['layers:patchProperty', { targets, patch }]),
    );
  });

  it('counter layout outcome-unknown은 same literal default retry를 한 번만 한다', async () => {
    mocks.sendPluginRpc
      .mockResolvedValueOnce({ kind: 'unknown' })
      .mockResolvedValueOnce({
        kind: 'ok',
        response: { modelRevision: 1 },
      });
    const pending = actions.patchCounterLayoutViaAuthority(
      [
        {
          elementType: 'key',
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
      ],
      { counterGap: 4_294_967_295 },
    );
    await vi.waitFor(() =>
      expect(mocks.sendBridgeMessageBestEffort).toHaveBeenCalledOnce(),
    );
    actions.notePluginMirrorRevision(1);
    await expect(pending).resolves.toBe(true);
    expect(mocks.sendPluginRpc).toHaveBeenCalledTimes(2);
    expect(mocks.sendPluginRpc.mock.calls[1]?.[1]).toEqual(
      mocks.sendPluginRpc.mock.calls[0]?.[1],
    );
  });

  it('counter typography 5 batch는 exact key/stat target과 default envelope를 보낸다', async () => {
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
        elementType: 'stat' as const,
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      },
    ];
    const patches: EditorCounterTypographyPropertyPatchV1[] = [
      { counterFontSize: 72 },
      { counterFontWeight: 900 },
      { counterFontItalic: true },
      { counterFontUnderline: true },
      { counterFontStrikethrough: true },
    ];

    for (const patch of patches) {
      await expect(
        actions.patchCounterTypographyViaAuthority(targets, patch),
      ).resolves.toBe(true);
    }
    expect(
      mocks.sendPluginRpc.mock.calls.map((call) => call.slice(0, 2)),
    ).toEqual(
      patches.map((patch) => ['layers:patchProperty', { targets, patch }]),
    );
  });

  it('counter typography outcome-unknown은 same literal default retry를 한 번만 한다', async () => {
    mocks.sendPluginRpc
      .mockResolvedValueOnce({ kind: 'unknown' })
      .mockResolvedValueOnce({
        kind: 'ok',
        response: { modelRevision: 1 },
      });
    const pending = actions.patchCounterTypographyViaAuthority(
      [
        {
          elementType: 'key',
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
      ],
      { counterFontSize: 72 },
    );
    await vi.waitFor(() =>
      expect(mocks.sendBridgeMessageBestEffort).toHaveBeenCalledOnce(),
    );
    actions.notePluginMirrorRevision(1);
    await expect(pending).resolves.toBe(true);
    expect(mocks.sendPluginRpc).toHaveBeenCalledTimes(2);
    expect(mocks.sendPluginRpc.mock.calls[1]?.[1]).toEqual(
      mocks.sendPluginRpc.mock.calls[0]?.[1],
    );
  });

  it('counter fontFamily batch는 raw exact key/stat target과 default envelope를 보낸다', async () => {
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
        elementType: 'stat' as const,
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      },
    ];

    await expect(
      actions.patchCounterTypographyViaAuthority(targets, {
        counterFontFamily: '  Raw Counter Family  ',
      }),
    ).resolves.toBe(true);
    expect(mocks.sendPluginRpc).toHaveBeenCalledWith(
      'layers:patchProperty',
      {
        targets,
        patch: { counterFontFamily: '  Raw Counter Family  ' },
      },
      0,
      7,
    );
  });

  it('counter fontFamily outcome-unknown은 same raw literal default retry를 한 번만 한다', async () => {
    mocks.sendPluginRpc
      .mockResolvedValueOnce({ kind: 'unknown' })
      .mockResolvedValueOnce({
        kind: 'ok',
        response: { modelRevision: 1 },
      });
    const pending = actions.patchCounterTypographyViaAuthority(
      [
        {
          elementType: 'key',
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
      ],
      { counterFontFamily: '' },
    );
    await vi.waitFor(() =>
      expect(mocks.sendBridgeMessageBestEffort).toHaveBeenCalledOnce(),
    );
    actions.notePluginMirrorRevision(1);
    await expect(pending).resolves.toBe(true);
    expect(mocks.sendPluginRpc).toHaveBeenCalledTimes(2);
    expect(mocks.sendPluginRpc.mock.calls[1]?.[1]).toEqual(
      mocks.sendPluginRpc.mock.calls[0]?.[1],
    );
  });

  it('counter stroke 2 batch는 exact target과 default envelope를 보낸다', async () => {
    mocks.sendPluginRpc.mockResolvedValue({
      kind: 'ok',
      response: { modelRevision: 1 },
    });
    const idleTargets = [
      {
        elementType: 'key' as const,
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      {
        elementType: 'stat' as const,
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      },
    ];
    const cases: Array<{
      targets: typeof idleTargets;
      patch: EditorCounterStrokePropertyPatchV1;
    }> = [
      { targets: idleTargets, patch: { counterStrokeIdle: '  raw idle  ' } },
      {
        targets: [idleTargets[0]],
        patch: { counterStrokeActive: '' },
      },
    ];

    for (const { targets, patch } of cases) {
      await expect(
        actions.patchCounterStrokeViaAuthority(targets, patch),
      ).resolves.toBe(true);
    }
    expect(
      mocks.sendPluginRpc.mock.calls.map((call) => call.slice(0, 2)),
    ).toEqual(
      cases.map(({ targets, patch }) => [
        'layers:patchProperty',
        { targets, patch },
      ]),
    );
  });

  it('counter stroke outcome-unknown은 same raw literal default retry를 한 번만 한다', async () => {
    mocks.sendPluginRpc
      .mockResolvedValueOnce({ kind: 'unknown' })
      .mockResolvedValueOnce({
        kind: 'ok',
        response: { modelRevision: 1 },
      });
    const pending = actions.patchCounterStrokeViaAuthority(
      [
        {
          elementType: 'key',
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
      ],
      { counterStrokeActive: '  raw active  ' },
    );
    await vi.waitFor(() =>
      expect(mocks.sendBridgeMessageBestEffort).toHaveBeenCalledOnce(),
    );
    actions.notePluginMirrorRevision(1);
    await expect(pending).resolves.toBe(true);
    expect(mocks.sendPluginRpc).toHaveBeenCalledTimes(2);
    expect(mocks.sendPluginRpc.mock.calls[1]?.[1]).toEqual(
      mocks.sendPluginRpc.mock.calls[0]?.[1],
    );
    expect(mocks.sendPluginRpc.mock.calls[1]?.[3]).toBe(7);
  });

  it('counter fill은 exact state descriptor와 default envelope를 보낸다', async () => {
    mocks.sendPluginRpc.mockResolvedValueOnce({
      kind: 'ok',
      response: { modelRevision: 2 },
    });
    const targets = [
      {
        elementType: 'stat' as const,
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
    ];
    const patch = { counterFillIdle: { color: ' raw solid ' } } as const;

    await expect(
      actions.patchCounterFillViaAuthority(targets, patch),
    ).resolves.toBe(true);
    expect(mocks.sendPluginRpc).toHaveBeenCalledWith(
      'layers:patchProperty',
      { targets, patch },
      0,
      7,
    );
  });

  it('counter fill outcome-unknown은 same descriptor를 한 번만 재전송한다', async () => {
    mocks.sendPluginRpc
      .mockResolvedValueOnce({ kind: 'unknown' })
      .mockResolvedValueOnce({
        kind: 'ok',
        response: { modelRevision: 2 },
      });
    const changed = actions.patchCounterFillViaAuthority(
      [
        {
          elementType: 'key',
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
      ],
      { counterFillActive: { color: ' active solid ' } },
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
  });

  it('counter animation update/delete는 exact descriptor와 성공 payload를 반환한다', async () => {
    const updateResponse = {
      preset: { id: 'preset-a' },
      affectedUsageCount: 2,
    };
    const deleteResponse = {
      success: true,
      id: 'preset-a',
      affectedUsageCount: 2,
      fallbackPresetId: 'builtin-ease-out',
    };
    mocks.sendPluginRpc
      .mockResolvedValueOnce({
        kind: 'ok',
        response: { modelRevision: 1, payload: updateResponse },
      })
      .mockResolvedValueOnce({
        kind: 'ok',
        response: { modelRevision: 2, payload: deleteResponse },
      });
    const request = {
      id: 'preset-a',
      name: 'Preset A',
      bezier: [0.25, 0.1, 0.25, 1] as [number, number, number, number],
      scale: 1.2,
      durationMs: 400,
    };

    await expect(
      actions.updateCounterAnimationPresetViaAuthority(request),
    ).resolves.toEqual(updateResponse);
    await expect(
      actions.deleteCounterAnimationPresetViaAuthority('preset-a'),
    ).resolves.toEqual(deleteResponse);
    expect(mocks.sendPluginRpc.mock.calls[0]?.slice(0, 2)).toEqual([
      'counterAnimation:updatePreset',
      { request },
    ]);
    expect(mocks.sendPluginRpc.mock.calls[1]?.slice(0, 2)).toEqual([
      'counterAnimation:deletePreset',
      { id: 'preset-a' },
    ]);
  });

  it('counter animation update outcome-unknown은 snapshot만 요청하고 재실행하지 않는다', async () => {
    mocks.sendPluginRpc.mockResolvedValueOnce({ kind: 'unknown' });
    await expect(
      actions.updateCounterAnimationPresetViaAuthority({
        id: 'preset-a',
        name: 'Preset A',
        bezier: [0.25, 0.1, 0.25, 1],
        scale: 1.2,
        durationMs: 400,
      }),
    ).resolves.toBeNull();
    expect(mocks.sendPluginRpc).toHaveBeenCalledOnce();
    expect(mocks.sendBridgeMessageBestEffort).toHaveBeenCalledOnce();
  });

  it('counter animation delete stale은 fresh snapshot 뒤 한 번만 재실행한다', async () => {
    mocks.sendPluginRpc
      .mockResolvedValueOnce({
        kind: 'error',
        errorCode: 'MODEL_REVISION_STALE',
        response: { modelRevision: 1 },
      })
      .mockResolvedValueOnce({
        kind: 'ok',
        response: {
          modelRevision: 2,
          payload: { success: true, id: 'preset-a' },
        },
      });
    const deleting =
      actions.deleteCounterAnimationPresetViaAuthority('preset-a');
    await vi.waitFor(() =>
      expect(mocks.sendBridgeMessageBestEffort).toHaveBeenCalledOnce(),
    );
    actions.notePluginMirrorRevision(2);
    await expect(deleting).resolves.toMatchObject({ success: true });
    expect(mocks.sendPluginRpc).toHaveBeenCalledTimes(2);
    expect(mocks.sendPluginRpc.mock.calls[1]?.[1]).toEqual(
      mocks.sendPluginRpc.mock.calls[0]?.[1],
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

  it('displayText outcome-unknown은 같은 gesture와 raw literal을 한 번만 재전송한다', async () => {
    mocks.sendPluginRpc
      .mockResolvedValueOnce({ kind: 'unknown' })
      .mockResolvedValueOnce({
        kind: 'ok',
        response: { modelRevision: 2 },
      });
    const changed = actions.patchStylePropertyViaAuthority(
      [
        {
          elementType: 'stat',
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
      ],
      { displayText: '  Raw label  ' },
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
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

  it('numeric style outcome-unknown은 같은 gesture와 literal을 한 번만 재전송한다', async () => {
    mocks.sendPluginRpc
      .mockResolvedValueOnce({ kind: 'unknown' })
      .mockResolvedValueOnce({
        kind: 'ok',
        response: { modelRevision: 2 },
      });
    const changed = actions.patchStylePropertyViaAuthority(
      [
        {
          elementType: 'graph',
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
      ],
      { borderRadius: 99.5 },
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
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

  it('noteGlowSize outcome-unknown은 같은 literal을 gesture 없이 한 번만 재전송한다', async () => {
    mocks.sendPluginRpc
      .mockResolvedValueOnce({ kind: 'unknown' })
      .mockResolvedValueOnce({
        kind: 'ok',
        response: { modelRevision: 2 },
      });
    const changed = actions.patchStylePropertyViaAuthority(
      [
        {
          elementType: 'key',
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
      ],
      { noteGlowSize: 20.5 },
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

  it('note numeric outcome-unknown은 같은 nullable literal과 gesture를 한 번만 재전송한다', async () => {
    mocks.sendPluginRpc
      .mockResolvedValueOnce({ kind: 'unknown' })
      .mockResolvedValueOnce({
        kind: 'ok',
        response: { modelRevision: 2 },
      });
    const changed = actions.patchStylePropertyViaAuthority(
      [
        {
          elementType: 'key',
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
      ],
      { noteWidth: null },
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
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

  it('note paint는 key exact mask와 gesture를 default envelope에 고정한다', async () => {
    mocks.sendPluginRpc.mockResolvedValueOnce({
      kind: 'ok',
      response: { modelRevision: 2 },
    });
    const targets = [
      {
        elementType: 'key' as const,
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
    ];
    const patch = {
      noteGlowPaint: { opacity: 60, opacityTop: 50, opacityBottom: 40 },
    } as const;

    await expect(
      actions.patchNotePaintViaAuthority(
        targets.map(({ id }) => id),
        patch,
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      ),
    ).resolves.toBe(true);

    expect(mocks.sendPluginRpc).toHaveBeenCalledWith(
      'layers:patchProperty',
      {
        targets,
        patch,
        gestureId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      },
      0,
      7,
    );
  });

  it('note paint outcome-unknown은 같은 mask와 gesture를 한 번만 재전송한다', async () => {
    mocks.sendPluginRpc
      .mockResolvedValueOnce({ kind: 'unknown' })
      .mockResolvedValueOnce({
        kind: 'ok',
        response: { modelRevision: 2 },
      });
    const changed = actions.patchNotePaintViaAuthority(
      ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
      { noteBorderPaint: { color: '#A0B1C2', opacity: 65 } },
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
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

  it('inactiveImage batch outcome-unknown은 같은 generation과 raw literal을 한 번만 재전송한다', async () => {
    mocks.sendPluginRpc
      .mockResolvedValueOnce({ kind: 'unknown' })
      .mockResolvedValueOnce({
        kind: 'ok',
        response: { modelRevision: 2 },
      });
    const changed = actions.patchInactiveImageViaAuthority(
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
      '  Raw Image.png  ',
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

  it('soundVolume outcome-unknown은 같은 generation과 literal을 한 번만 재전송한다', async () => {
    mocks.sendPluginRpc
      .mockResolvedValueOnce({ kind: 'unknown' })
      .mockResolvedValueOnce({
        kind: 'ok',
        response: { modelRevision: 2 },
      });
    const changed = actions.patchSoundVolumeViaAuthority(
      ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
      137.5,
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
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

  it('activeImage batch outcome-unknown은 같은 generation과 raw literal을 한 번만 재전송한다', async () => {
    mocks.sendPluginRpc
      .mockResolvedValueOnce({ kind: 'unknown' })
      .mockResolvedValueOnce({
        kind: 'ok',
        response: { modelRevision: 2 },
      });
    const changed = actions.patchActiveImageViaAuthority(
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
      '  Raw Active.png  ',
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
    ['idle', 'patchIdleTransparentViaAuthority'],
    ['active', 'patchActiveTransparentViaAuthority'],
  ] as const)(
    '%s transparency outcome-unknown은 같은 generation과 bool을 한 번만 재전송한다',
    async (_label, method) => {
      mocks.sendPluginRpc
        .mockResolvedValueOnce({ kind: 'unknown' })
        .mockResolvedValueOnce({
          kind: 'ok',
          response: { modelRevision: 2 },
        });
      const changed = actions[method](
        [
          {
            elementType: 'key',
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          },
        ],
        true,
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
    },
  );

  it('soundPath outcome-unknown은 snapshot만 요청하고 옛 path를 재전송하지 않는다', async () => {
    mocks.sendPluginRpc.mockResolvedValueOnce({ kind: 'unknown' });

    await expect(
      actions.patchSoundPathViaAuthority(
        ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
        'sounds/deleted.wav',
      ),
    ).resolves.toBe(false);

    expect(mocks.sendPluginRpc).toHaveBeenCalledOnce();
    expect(mocks.sendBridgeMessageBestEffort).toHaveBeenCalledOnce();
  });

  it('soundEnabled outcome-unknown은 snapshot만 요청하고 값을 재전송하지 않는다', async () => {
    mocks.sendPluginRpc.mockResolvedValueOnce({ kind: 'unknown' });

    await expect(
      actions.patchSoundEnabledViaAuthority(
        ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
        true,
      ),
    ).resolves.toBe(false);

    expect(mocks.sendPluginRpc).toHaveBeenCalledOnce();
    expect(mocks.sendBridgeMessageBestEffort).toHaveBeenCalledOnce();
  });

  it('paint authority는 exact descriptor를 보내고 outcome-unknown을 재실행하지 않는다', async () => {
    mocks.sendPluginRpc.mockResolvedValueOnce({ kind: 'unknown' });
    const targets = [
      {
        elementType: 'key' as const,
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
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

    await expect(actions.patchPaintViaAuthority(targets, patch)).resolves.toBe(
      false,
    );

    expect(mocks.sendPluginRpc).toHaveBeenCalledOnce();
    expect(mocks.sendPluginRpc).toHaveBeenCalledWith(
      'layers:patchProperty',
      { targets, patch },
      0,
      7,
    );
    expect(mocks.sendBridgeMessageBestEffort).toHaveBeenCalledOnce();
  });

  it.each(['MODEL_REVISION_STALE', 'PLUGIN_MODEL_REVISION_CONFLICT'])(
    'paint %s은 fresh snapshot 뒤 exact descriptor를 한 번만 재전송한다',
    async (errorCode) => {
      mocks.sendPluginRpc
        .mockResolvedValueOnce({
          kind: 'error',
          errorCode,
          response: { modelRevision: 1 },
        })
        .mockResolvedValueOnce({
          kind: 'ok',
          response: { modelRevision: 2 },
        });
      const changed = actions.patchPaintViaAuthority(
        [
          {
            elementType: 'knob',
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          },
        ],
        { activeBorderPaint: { color: ' raw ', gradient: null } },
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
    },
  );

  it('shadow authority는 exact mask를 보내고 outcome-unknown을 재실행하지 않는다', async () => {
    mocks.sendPluginRpc.mockResolvedValueOnce({ kind: 'unknown' });
    const targets = [
      {
        elementType: 'key' as const,
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
    ];
    const patch = { shadow: { blur: 22.5 } };

    await expect(actions.patchShadowViaAuthority(targets, patch)).resolves.toBe(
      false,
    );
    expect(mocks.sendPluginRpc).toHaveBeenCalledOnce();
    expect(mocks.sendPluginRpc).toHaveBeenCalledWith(
      'layers:patchProperty',
      { targets, patch },
      0,
      7,
    );
    expect(mocks.sendBridgeMessageBestEffort).toHaveBeenCalledOnce();
  });

  it.each(['MODEL_REVISION_STALE', 'PLUGIN_MODEL_REVISION_CONFLICT'])(
    'shadow %s은 fresh snapshot 뒤 same literal을 한 번 재전송한다',
    async (errorCode) => {
      mocks.sendPluginRpc
        .mockResolvedValueOnce({
          kind: 'error',
          errorCode,
          response: { modelRevision: 1 },
        })
        .mockResolvedValueOnce({
          kind: 'ok',
          response: { modelRevision: 2 },
        });
      const changed = actions.patchShadowViaAuthority(
        [
          {
            elementType: 'stat',
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          },
        ],
        { shadowEnabled: false },
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
    },
  );

  it.each(['MODEL_REVISION_STALE', 'PLUGIN_MODEL_REVISION_CONFLICT'])(
    'soundEnabled %s은 fresh snapshot 뒤 same generation과 bool을 한 번 재전송한다',
    async (errorCode) => {
      mocks.sendPluginRpc
        .mockResolvedValueOnce({
          kind: 'error',
          errorCode,
          response: { modelRevision: 1 },
        })
        .mockResolvedValueOnce({
          kind: 'ok',
          response: { modelRevision: 2 },
        });
      const changed = actions.patchSoundEnabledViaAuthority(
        ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
        true,
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
    },
  );

  it('soundEnabled revision stale 대기 중 generation이 바뀌면 재전송하지 않는다', async () => {
    mocks.sendPluginRpc.mockResolvedValueOnce({
      kind: 'error',
      errorCode: 'MODEL_REVISION_STALE',
      response: { modelRevision: 1 },
    });
    const changed = actions.patchSoundEnabledViaAuthority(
      ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
      true,
    );
    await vi.waitFor(() =>
      expect(mocks.sendBridgeMessageBestEffort).toHaveBeenCalledOnce(),
    );
    mocks.authorityGeneration = 8;
    actions.notePluginMirrorRevision(2);

    await expect(changed).resolves.toBe(false);
    expect(mocks.sendPluginRpc).toHaveBeenCalledOnce();
  });

  it.each(['MODEL_REVISION_STALE', 'PLUGIN_MODEL_REVISION_CONFLICT'])(
    'soundPath %s은 fresh snapshot 뒤 same generation과 raw literal로 한 번 재전송한다',
    async (errorCode) => {
      mocks.sendPluginRpc
        .mockResolvedValueOnce({
          kind: 'error',
          errorCode,
          response: { modelRevision: 1 },
        })
        .mockResolvedValueOnce({
          kind: 'ok',
          response: { modelRevision: 2 },
        });
      const changed = actions.patchSoundPathViaAuthority(
        ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
        '  sounds/raw.wav  ',
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
    },
  );

  it('soundPath revision stale 대기 중 generation이 바뀌면 재전송하지 않는다', async () => {
    mocks.sendPluginRpc.mockResolvedValueOnce({
      kind: 'error',
      errorCode: 'MODEL_REVISION_STALE',
      response: { modelRevision: 1 },
    });
    const changed = actions.patchSoundPathViaAuthority(
      ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
      'sounds/raw.wav',
    );
    await vi.waitFor(() =>
      expect(mocks.sendBridgeMessageBestEffort).toHaveBeenCalledOnce(),
    );
    mocks.authorityGeneration = 8;
    actions.notePluginMirrorRevision(2);

    await expect(changed).resolves.toBe(false);
    expect(mocks.sendPluginRpc).toHaveBeenCalledOnce();
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

  it('axisId outcome-unknown은 같은 generation과 raw literal로 한 번 재시도한다', async () => {
    mocks.sendPluginRpc
      .mockResolvedValueOnce({ kind: 'unknown' })
      .mockResolvedValueOnce({
        kind: 'ok',
        response: { modelRevision: 2 },
      });
    const changed = actions.patchNativeLayerPropertyViaAuthority({
      elementType: 'knob',
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      patch: { axisId: '  HIDA:raw  ' },
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

  it('image fit outcome-unknown은 같은 generation과 exact enum으로 한 번 재시도한다', async () => {
    mocks.sendPluginRpc
      .mockResolvedValueOnce({ kind: 'unknown' })
      .mockResolvedValueOnce({
        kind: 'ok',
        response: { modelRevision: 2 },
      });
    const changed = actions.patchNativeLayerPropertyViaAuthority({
      elementType: 'knob',
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      patch: { activeImageFit: 'contain' },
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
