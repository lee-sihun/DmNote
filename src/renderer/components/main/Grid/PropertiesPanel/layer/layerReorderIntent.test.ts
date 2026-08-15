import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';

import type { CanonicalEditorDocumentV1 } from '@src/types/editor';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';

const mocks = vi.hoisted(() => ({
  runMixed: vi.fn(),
  begin: vi.fn(),
  cancel: vi.fn(),
  rotate: vi.fn(),
}));

vi.mock('@src/renderer/editor/runtime/mixedElementIntent', () => ({
  runMixedGestureElementIntent: mocks.runMixed,
}));
vi.mock('@plugins/runtime/displayElement/gestureTransaction', () => ({
  beginMixedGestureTransaction: mocks.begin,
  cancelUncommittedMixedGestureTransaction: mocks.cancel,
}));
vi.mock('@plugins/runtime/displayElement/instancesCommitQueue', () => ({
  rotatePluginInstancesEditSession: mocks.rotate,
}));

import { commitLayerDropIntent } from './layerReorderIntent';

const ID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ID_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const documentWith = (
  keys: Array<{ id: string; zIndex: number; groupId?: string }>,
  groups: Array<{ id: string; name: string }> = [],
): CanonicalEditorDocumentV1 =>
  ({
    schemaVersion: 1,
    keys: { '4key': keys.map((_, index) => String(index)) },
    keyPositions: {
      '4key': keys.map((item) => ({ ...createDefaultKeyPosition(), ...item })),
    },
    statPositions: {},
    graphPositions: {},
    knobPositions: {},
    layerGroups: groups.length > 0 ? { '4key': groups } : {},
  } as never);

const plugin = (
  fullId: string,
  zIndex: number,
  tabId?: string,
): PluginDisplayElementInternal =>
  ({
    id: fullId,
    fullId,
    pluginId: 'runtime-plugin-id',
    definitionId: 'definition-id',
    position: { x: 0, y: 0 },
    zIndex,
    tabId,
  } as never);

const installDocument = (document: CanonicalEditorDocumentV1) => {
  useKeyStore.setState({
    keyMappings: document.keys,
    canonicalPositions: document.keyPositions,
    positions: document.keyPositions,
  });
  useStatItemStore.setState({ positions: document.statPositions });
  useGraphItemStore.setState({ positions: document.graphPositions });
  useKnobItemStore.setState({ positions: document.knobPositions });
  useLayerGroupStore.setState({
    layerGroups: document.layerGroups,
    collapsedGroups: new Set(),
  });
};

describe('layer reorder slot generation', () => {
  beforeEach(() => {
    mocks.runMixed.mockReset();
    mocks.runMixed.mockResolvedValue({ committed: true, satisfied: true });
    mocks.begin.mockClear();
    mocks.cancel.mockClear();
    mocks.rotate.mockClear();
    usePluginDisplayElementStore.setState({ elements: [] });
  });

  it('슬롯 최신 native와 mode plugin을 포함해 bottom 경계를 다시 푼다', async () => {
    const initial = documentWith([
      { id: ID_A, zIndex: 2 },
      { id: ID_B, zIndex: 1 },
    ]);
    installDocument(initial);
    usePluginDisplayElementStore.setState({
      elements: [plugin('plugin:one', 0, '4key')],
    });

    await commitLayerDropIntent({
      kind: 'items',
      mode: '4key',
      collapsedGroupIds: [],
      draggedIds: [ID_A],
      anchors: {
        toDisplayIndex: 3,
        targetGroupId: undefined,
        boundary: 'bottom',
      },
      preserveFullGroups: false,
    });

    expect(mocks.begin).toHaveBeenCalledWith(expect.any(String), [
      'runtime-plugin-id',
    ]);
    expect(mocks.rotate).toHaveBeenCalledWith(
      'runtime-plugin-id',
      expect.any(String),
    );
    const options = mocks.runMixed.mock.calls[0]?.[0];
    const slot = documentWith([
      { id: ID_A, zIndex: 3 },
      { id: ID_B, zIndex: 2 },
      { id: ID_C, zIndex: 1 },
    ]);
    const generation = options.generate({
      base: slot,
      pluginProjection: [
        plugin('plugin:one', 0, '4key'),
        plugin('plugin:new', -1),
        plugin('plugin:other-mode', 99, '7key'),
      ],
    });

    expect(generation.kind).toBe('ops');
    expect(generation.ops).toEqual([
      {
        kind: 'reorderElements',
        mode: '4key',
        completeModeOrder: true,
        groupUpdates: [{ elementType: 'key', id: ID_A, groupId: null }],
        zUpdates: [
          { elementType: 'key', id: ID_B, zIndex: 4 },
          { elementType: 'key', id: ID_C, zIndex: 3 },
          { elementType: 'key', id: ID_A, zIndex: 0 },
        ],
      },
    ]);
    const desired =
      generation.desiredPluginProjection as PluginDisplayElementInternal[];
    expect(
      desired.find((element) => element.fullId === 'plugin:one')?.zIndex,
    ).toBe(2);
    expect(
      desired.find((element) => element.fullId === 'plugin:new')?.zIndex,
    ).toBe(1);
    expect(
      desired.find((element) => element.fullId === 'plugin:other-mode')?.zIndex,
    ).toBe(99);
    expect(options.retryEditorOnly).toBe(false);
    expect(
      options.pluginScope([
        plugin('plugin:one', 0, '4key'),
        { ...plugin('plugin:new', -1), pluginId: 'runtime-global' },
        {
          ...plugin('plugin:other-mode', 99, '7key'),
          pluginId: 'runtime-other',
        },
      ]),
    ).toEqual(['runtime-plugin-id', 'runtime-global']);
  });

  it('캡처한 앵커가 둘 다 소실되면 전체 의도를 중단한다', async () => {
    const initial = documentWith([
      { id: ID_A, zIndex: 2 },
      { id: ID_B, zIndex: 1 },
    ]);
    installDocument(initial);
    await commitLayerDropIntent({
      kind: 'items',
      mode: '4key',
      collapsedGroupIds: [],
      draggedIds: [ID_A],
      anchors: {
        toDisplayIndex: 1,
        targetGroupId: undefined,
        anchorBeforeId: ID_B,
        anchorAfterId: ID_C,
      },
      preserveFullGroups: false,
    });
    const options = mocks.runMixed.mock.calls[0]?.[0];
    const stale = documentWith([{ id: ID_A, zIndex: 0 }]);
    expect(() =>
      options.generate({ base: stale, pluginProjection: [] }),
    ).toThrow('drop anchors stale');
  });

  it('호출 창에서 동결한 접힘 상태로 child 앵커를 해석한다', async () => {
    installDocument(
      documentWith(
        [
          { id: ID_A, zIndex: 2 },
          { id: ID_B, zIndex: 1, groupId: 'group-a' },
        ],
        [{ id: 'group-a', name: 'A' }],
      ),
    );
    useLayerGroupStore.setState({ collapsedGroups: new Set(['group-a']) });
    await commitLayerDropIntent({
      kind: 'items',
      mode: '4key',
      collapsedGroupIds: [],
      draggedIds: [ID_A],
      anchors: {
        toDisplayIndex: 2,
        targetGroupId: 'group-a',
        anchorAfterId: ID_B,
      },
      preserveFullGroups: false,
    });
    const options = mocks.runMixed.mock.calls[0]?.[0];
    expect(() =>
      options.generate({
        base: documentWith(
          [
            { id: ID_A, zIndex: 2 },
            { id: ID_B, zIndex: 1, groupId: 'group-a' },
          ],
          [{ id: 'group-a', name: 'A' }],
        ),
        pluginProjection: [],
      }),
    ).not.toThrow();
  });

  it('plugin-only reorder도 editor op 없이 desired projection만 만든다', async () => {
    installDocument(documentWith([]));
    usePluginDisplayElementStore.setState({
      elements: [
        plugin('plugin:one', 1, '4key'),
        plugin('plugin:two', 0, '4key'),
      ],
    });
    await commitLayerDropIntent({
      kind: 'items',
      mode: '4key',
      collapsedGroupIds: [],
      draggedIds: ['plugin:one'],
      anchors: {
        toDisplayIndex: 2,
        targetGroupId: undefined,
        boundary: 'bottom',
      },
      preserveFullGroups: false,
    });
    const options = mocks.runMixed.mock.calls[0]?.[0];
    const generation = options.generate({
      base: documentWith([]),
      pluginProjection: [
        plugin('plugin:one', 1, '4key'),
        plugin('plugin:two', 0, '4key'),
      ],
    });
    expect(generation.kind).toBe('patch');
    expect(generation.patch).toBeNull();
    expect(
      generation.desiredPluginProjection.map(
        (element: PluginDisplayElementInternal) => [
          element.fullId,
          element.zIndex,
        ],
      ),
    ).toEqual([
      ['plugin:one', 0],
      ['plugin:two', 1],
    ]);
  });

  it('그룹 드래그는 슬롯 시점에 새로 들어온 그룹 멤버까지 함께 옮긴다', async () => {
    installDocument(
      documentWith(
        [
          { id: ID_A, zIndex: 2, groupId: 'group-a' },
          { id: ID_B, zIndex: 1 },
        ],
        [{ id: 'group-a', name: 'A' }],
      ),
    );
    await commitLayerDropIntent({
      kind: 'group',
      mode: '4key',
      collapsedGroupIds: [],
      groupId: 'group-a',
      extraIds: [],
      anchors: {
        toDisplayIndex: 3,
        targetGroupId: undefined,
        boundary: 'bottom',
      },
    });
    const options = mocks.runMixed.mock.calls[0]?.[0];
    const slot = documentWith(
      [
        { id: ID_A, zIndex: 3, groupId: 'group-a' },
        { id: ID_B, zIndex: 2 },
        { id: ID_C, zIndex: 1, groupId: 'group-a' },
      ],
      [{ id: 'group-a', name: 'A' }],
    );
    const generation = options.generate({ base: slot, pluginProjection: [] });
    expect(
      generation.ops[0].zUpdates.map((update: { id: string }) => update.id),
    ).toEqual([ID_B, ID_A, ID_C]);
    expect(generation.ops[0].groupUpdates).toEqual([
      { elementType: 'key', id: ID_A, groupId: 'group-a' },
      { elementType: 'key', id: ID_C, groupId: 'group-a' },
    ]);
  });

  it('그룹 드롭은 plugin groupId를 eager와 desired에 반영하고 receipt는 CAS 복원한다', async () => {
    installDocument(
      documentWith(
        [{ id: ID_A, zIndex: 2, groupId: 'group-a' }],
        [{ id: 'group-a', name: 'A' }],
      ),
    );
    usePluginDisplayElementStore.setState({
      elements: [plugin('plugin:one', 1, '4key')],
    });

    await commitLayerDropIntent({
      kind: 'items',
      mode: '4key',
      collapsedGroupIds: [],
      draggedIds: ['plugin:one'],
      anchors: {
        toDisplayIndex: 1,
        targetGroupId: 'group-a',
        anchorHeaderGroupId: 'group-a',
      },
      preserveFullGroups: false,
    });

    // eager: plugin 소속이 스토어에 즉시 반영
    expect(usePluginDisplayElementStore.getState().elements[0]?.groupId).toBe(
      'group-a',
    );

    const options = mocks.runMixed.mock.calls[0]?.[0];
    const generation = options.generate({
      base: documentWith(
        [{ id: ID_A, zIndex: 2, groupId: 'group-a' }],
        [{ id: 'group-a', name: 'A' }],
      ),
      pluginProjection: [plugin('plugin:one', 1, '4key')],
    });
    const desired =
      generation.desiredPluginProjection as PluginDisplayElementInternal[];
    expect(
      desired.find((element) => element.fullId === 'plugin:one')?.groupId,
    ).toBe('group-a');
    // op는 native만 운반 - plugin 소속은 desired projection(pluginChanges) 몫
    expect(generation.ops[0].groupUpdates).toEqual([]);

    // receipt CAS: 우리가 쓴 값 그대로일 때만 복원
    options.receipt.rollback();
    expect(
      usePluginDisplayElementStore.getState().elements[0]?.groupId,
    ).toBeUndefined();
  });

  it('저장 규칙 밖 모드의 plugin에는 그룹 소속을 부여하지 않는다', async () => {
    installDocument(
      documentWith(
        [{ id: ID_A, zIndex: 2, groupId: 'group-a' }],
        [{ id: 'group-a', name: 'A' }],
      ),
    );
    // tabId 미지정 - 표시상 모든 모드에 보이지만 저장은 4key 소속.
    // 4key 그룹 소속을 가진 채 7key에서 드래그해도 소속이 지워지면 안 된다
    const globalPlugin = {
      ...plugin('plugin:global', 1),
      groupId: 'group-a',
    } as PluginDisplayElementInternal;
    usePluginDisplayElementStore.setState({ elements: [globalPlugin] });

    await commitLayerDropIntent({
      kind: 'items',
      mode: '7key',
      collapsedGroupIds: [],
      draggedIds: ['plugin:global'],
      anchors: {
        toDisplayIndex: 1,
        targetGroupId: undefined,
        boundary: 'bottom',
      },
      preserveFullGroups: false,
    });

    const options = mocks.runMixed.mock.calls[0]?.[0];
    const generation = options.generate({
      base: documentWith([]),
      pluginProjection: [globalPlugin],
    });
    const desired =
      generation.desiredPluginProjection as PluginDisplayElementInternal[];
    // 저장 규칙(4key) 밖 모드의 드롭은 groupId를 건드리지 않는다 (z 재부여만)
    expect(
      desired.find((element) => element.fullId === 'plugin:global')?.groupId,
    ).toBe('group-a');
    expect(usePluginDisplayElementStore.getState().elements[0]?.groupId).toBe(
      'group-a',
    );
  });

  it('초기 eager를 적용하고 실패 receipt는 자기 값만 복원한다', async () => {
    installDocument(
      documentWith(
        [
          { id: ID_A, zIndex: 2, groupId: 'group-a' },
          { id: ID_B, zIndex: 1 },
        ],
        [{ id: 'group-a', name: 'A' }],
      ),
    );
    usePluginDisplayElementStore.setState({
      elements: [plugin('plugin:one', 0, '4key')],
    });
    await commitLayerDropIntent({
      kind: 'items',
      mode: '4key',
      collapsedGroupIds: [],
      draggedIds: [ID_A],
      anchors: {
        toDisplayIndex: 3,
        targetGroupId: undefined,
        boundary: 'bottom',
      },
      preserveFullGroups: false,
    });
    expect(
      useKeyStore
        .getState()
        .canonicalPositions['4key']?.find((position) => position.id === ID_A),
    ).toMatchObject({ zIndex: 0, groupId: undefined });
    expect(usePluginDisplayElementStore.getState().elements[0]?.zIndex).toBe(1);

    useKeyStore.setState((state) => ({
      canonicalPositions: {
        ...state.canonicalPositions,
        '4key': state.canonicalPositions['4key'].map((position) =>
          position.id === ID_A ? { ...position, zIndex: 99 } : position,
        ),
      },
    }));
    mocks.runMixed.mock.calls[0]?.[0].receipt.rollback();
    expect(
      useKeyStore
        .getState()
        .canonicalPositions['4key']?.find((position) => position.id === ID_A)
        ?.zIndex,
    ).toBe(99);
    expect(usePluginDisplayElementStore.getState().elements[0]?.zIndex).toBe(0);
  });

  it('plugin eager가 실패하면 먼저 적용한 native eager를 복원하고 정산한다', async () => {
    installDocument(
      documentWith([
        { id: ID_A, zIndex: 2 },
        { id: ID_B, zIndex: 1 },
      ]),
    );
    usePluginDisplayElementStore.setState({
      elements: [plugin('plugin:one', 0, '4key')],
    });
    const store = usePluginDisplayElementStore.getState();
    const originalSetElements = store.setElements;
    const failure = new Error('plugin eager failed');
    vi.spyOn(store, 'setElements').mockImplementationOnce((next) => {
      usePluginDisplayElementStore.setState({ elements: next });
      throw failure;
    });

    await expect(
      commitLayerDropIntent({
        kind: 'items',
        mode: '4key',
        collapsedGroupIds: [],
        draggedIds: [ID_A],
        anchors: {
          toDisplayIndex: 3,
          targetGroupId: undefined,
          boundary: 'bottom',
        },
        preserveFullGroups: false,
      }),
    ).rejects.toBe(failure);
    expect(
      useKeyStore
        .getState()
        .canonicalPositions['4key'].map((position) => position.zIndex),
    ).toEqual([2, 1]);
    expect(mocks.runMixed).not.toHaveBeenCalled();
    expect(mocks.cancel).toHaveBeenCalledOnce();
    expect(usePluginDisplayElementStore.getState().elements[0]?.zIndex).toBe(0);
    usePluginDisplayElementStore.setState({ setElements: originalSetElements });
  });

  it('plugin session 회전이 실패해도 시작한 gesture를 정산한다', async () => {
    installDocument(documentWith([{ id: ID_A, zIndex: 1 }]));
    usePluginDisplayElementStore.setState({
      elements: [plugin('plugin:one', 0, '4key')],
    });
    mocks.rotate.mockImplementationOnce(() => {
      throw new Error('rotate failed');
    });
    await expect(
      commitLayerDropIntent({
        kind: 'items',
        mode: '4key',
        collapsedGroupIds: [],
        draggedIds: [ID_A],
        anchors: {
          toDisplayIndex: 2,
          targetGroupId: undefined,
          boundary: 'bottom',
        },
        preserveFullGroups: false,
      }),
    ).rejects.toThrow('rotate failed');
    expect(mocks.cancel).toHaveBeenCalledOnce();
    expect(mocks.runMixed).not.toHaveBeenCalled();
  });
});
