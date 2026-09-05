import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useKeyStore } from '@stores/data/useKeyStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';

import type { LayerItem } from '../types';

const mocks = vi.hoisted(() => ({
  patchHidden: vi.fn(() => Promise.resolve(true)),
  patchLayerName: vi.fn(() => Promise.resolve(true)),
  patchPropertyViaAuthority: vi.fn(() => Promise.resolve(true)),
  setGroupVisibilityViaAuthority: vi.fn(() => Promise.resolve(true)),
  setGroupHidden: vi.fn(() => Promise.resolve(true)),
  setGroupHiddenLegacy: vi.fn(() => Promise.resolve(true)),
  setElementGroups: vi.fn(() => Promise.resolve(true)),
  setMixedElementGroups: vi.fn(() => Promise.resolve(true)),
  setMixedGroupHidden: vi.fn(() => Promise.resolve(true)),
  renameLayerGroup: vi.fn(() => Promise.resolve(true)),
  setElementGroupsViaAuthority: vi.fn(() => Promise.resolve(true)),
  renameLayerGroupViaAuthority: vi.fn(() => Promise.resolve(true)),
  setPluginHidden: vi.fn(() => Promise.resolve(true)),
  reportSkipped: vi.fn(),
  updateKeyPositions: vi.fn(() => Promise.resolve()),
  commitPatch: vi.fn(() => Promise.resolve()),
}));

vi.mock('@src/renderer/editor/runtime/elementOps', () => ({
  patchElementHiddenById: mocks.patchHidden,
  patchElementLayerNameById: mocks.patchLayerName,
  setLayerGroupHidden: mocks.setGroupHidden,
  setLayerGroupHiddenLegacy: mocks.setGroupHiddenLegacy,
  setElementGroupsByTargets: mocks.setElementGroups,
  renameLayerGroupById: mocks.renameLayerGroup,
}));
vi.mock('@src/renderer/editor/runtime/deleteFrozenSelection', () => ({
  deleteFrozenSelection: vi.fn(),
}));
vi.mock('@src/renderer/editor/runtime/mixedElementGroups', () => ({
  setMixedElementGroups: mocks.setMixedElementGroups,
  setMixedLayerGroupHidden: mocks.setMixedGroupHidden,
}));
vi.mock('@plugins/runtime/displayElement/pluginElementActions', () => ({
  patchNativeLayerPropertyViaAuthority: mocks.patchPropertyViaAuthority,
  setLayerGroupVisibilityViaAuthority: mocks.setGroupVisibilityViaAuthority,
  setElementGroupsViaAuthority: mocks.setElementGroupsViaAuthority,
  renameLayerGroupViaAuthority: mocks.renameLayerGroupViaAuthority,
  setPluginElementsHidden: mocks.setPluginHidden,
}));
vi.mock('@src/renderer/editor/runtime/elementIntent', () => ({
  reportElementOpSkipped: mocks.reportSkipped,
}));
vi.mock('@api/modules/keysApi', () => ({
  keysApi: { updatePositions: mocks.updateKeyPositions },
}));
vi.mock('@src/renderer/editor/runtime/editorStateCoordinator', () => ({
  editorCoordinator: { commitPatch: mocks.commitPatch },
}));

import { useLayerActions } from './useLayerActions';

const STABLE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

type Actions = ReturnType<typeof useLayerActions>;

const Harness = ({
  expose,
  layerItems = [],
}: {
  expose: (actions: Actions) => void;
  layerItems?: LayerItem[];
}) => {
  const actions = useLayerActions({
    selectedKeyType: '4key',
    layerItems,
    layerGroupsForMode: [],
    clearPendingDeselect: () => {},
    displayItemsRef: React.useRef([]),
    setLastClickedIndex: () => {},
    setLastClickedDisplayIndex: () => {},
    t: (key) => key,
  });
  // eslint-disable-next-line react-hooks/refs -- 반환 ref를 포함한 공개 훅 계약 노출
  expose(actions);
  // eslint-disable-next-line react-hooks/refs -- 반환된 rename input ref 연결 계약 검증
  return <input ref={actions.renameInputRef} aria-label="rename input" />;
};

describe('useLayerActions visibility routing', () => {
  let host: HTMLDivElement;
  let root: Root;
  let actions: Actions;
  let originalWindowType: typeof window.__dmn_window_type;

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    originalWindowType = window.__dmn_window_type;
    window.__dmn_window_type = 'main';
    mocks.patchHidden.mockClear();
    mocks.patchLayerName.mockClear();
    mocks.patchPropertyViaAuthority.mockClear();
    mocks.setGroupVisibilityViaAuthority.mockClear();
    mocks.setGroupHidden.mockClear();
    mocks.setGroupHiddenLegacy.mockClear();
    mocks.setElementGroups.mockClear();
    mocks.setMixedElementGroups.mockClear();
    mocks.setMixedElementGroups.mockResolvedValue(true);
    mocks.setMixedGroupHidden.mockClear();
    mocks.setMixedGroupHidden.mockResolvedValue(true);
    mocks.renameLayerGroup.mockClear();
    mocks.setElementGroupsViaAuthority.mockClear();
    mocks.renameLayerGroupViaAuthority.mockClear();
    mocks.setPluginHidden.mockClear();
    mocks.reportSkipped.mockClear();
    mocks.updateKeyPositions.mockClear();
    mocks.commitPatch.mockClear();
    useKeyStore.setState({
      canonicalPositions: {
        '4key': [{ id: STABLE_ID, dx: 0, dy: 0, width: 10, height: 10 }],
      } as never,
      positions: {
        '4key': [{ id: STABLE_ID, dx: 0, dy: 0, width: 10, height: 10 }],
      } as never,
    });
    useLayerGroupStore.setState({ layerGroups: {} });
    usePluginDisplayElementStore.setState({
      elements: [],
    });
    useGridSelectionStore.setState({
      selectedElements: [],
      selectedGroupIds: [],
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(
        <Harness
          expose={(next) => {
            actions = next;
          }}
        />,
      );
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    window.__dmn_window_type = originalWindowType;
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  });

  const click = {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as React.MouseEvent;

  const exposeWithItems = async (layerItems: LayerItem[]) => {
    await act(async () => {
      root.render(
        <Harness
          layerItems={layerItems}
          expose={(next) => {
            actions = next;
          }}
        />,
      );
    });
  };

  it('미선택 스프라이트 행 우클릭은 그 행을 선택한다', async () => {
    const item: LayerItem = {
      type: 'sprite',
      id: STABLE_ID,
      index: 0,
      name: '스프라이트 1',
      zIndex: 0,
      hidden: false,
    };

    await act(async () => actions.handleContextMenu(click, item, 0));

    // 종류 분기 누락 시 clearSelection만 남아 Delete가 조용히 무시된다
    expect(useGridSelectionStore.getState().selectedElements).toEqual([
      { type: 'sprite', id: STABLE_ID, index: 0 },
    ]);
  });

  it('stable native는 index가 틀려도 ID와 literal hidden으로 semantic op를 호출한다', async () => {
    const item: LayerItem = {
      type: 'key',
      id: STABLE_ID,
      index: 99,
      name: 'A',
      zIndex: 0,
      hidden: false,
    };
    await act(async () => actions.handleToggleVisibility(click, item));

    expect(mocks.patchHidden).toHaveBeenCalledWith('key', STABLE_ID, true);
    expect(mocks.patchPropertyViaAuthority).not.toHaveBeenCalled();
    expect(mocks.updateKeyPositions).not.toHaveBeenCalled();
  });

  it('invalid native visibility는 fail-closed로 어떤 writer도 호출하지 않는다', async () => {
    const item: LayerItem = {
      type: 'key',
      id: 'key-0',
      index: 0,
      name: 'legacy',
      zIndex: 0,
      hidden: false,
    };
    await act(async () => actions.handleToggleVisibility(click, item));

    expect(mocks.patchHidden).not.toHaveBeenCalled();
    expect(mocks.patchPropertyViaAuthority).not.toHaveBeenCalled();
    expect(mocks.updateKeyPositions).not.toHaveBeenCalled();
  });

  it('플러그인 가시성 토글 실패는 fail-closed로 기록한다', async () => {
    window.__dmn_window_type = 'panel';
    mocks.setPluginHidden.mockResolvedValueOnce(false);
    const item: LayerItem = {
      type: 'plugin',
      id: 'plugin-a:one',
      name: 'plugin',
      zIndex: 0,
      hidden: false,
    };
    await act(async () => actions.handleToggleVisibility(click, item));

    expect(mocks.setPluginHidden).toHaveBeenCalledWith([
      { fullId: 'plugin-a:one', hidden: true },
    ]);
    expect(mocks.reportSkipped).toHaveBeenCalledWith(
      'panel plugin visibility toggle',
    );
  });

  it('플러그인 가시성 토글 성공은 fail-closed 기록을 남기지 않는다', async () => {
    const item: LayerItem = {
      type: 'plugin',
      id: 'plugin-a:one',
      name: 'plugin',
      zIndex: 0,
      hidden: true,
    };
    await act(async () => actions.handleToggleVisibility(click, item));

    expect(mocks.setPluginHidden).toHaveBeenCalledWith([
      { fullId: 'plugin-a:one', hidden: false },
    ]);
    expect(mocks.reportSkipped).not.toHaveBeenCalled();
  });

  it('플러그인 이름 변경은 직접 메뉴 액션으로도 시작하지 않는다', async () => {
    const item: LayerItem = {
      type: 'plugin',
      id: 'plugin-a:one',
      name: 'plugin',
      zIndex: 0,
      hidden: false,
    };
    await act(async () => actions.handleContextMenu(click, item, 0));
    await act(async () => actions.handleContextMenuSelect('rename'));

    expect(actions.renamingItemId).toBeNull();
    expect(mocks.patchLayerName).not.toHaveBeenCalled();
  });

  it('main stable group은 allHidden에서 계산한 absolute literal만 semantic helper에 넘긴다', async () => {
    await exposeWithItems([
      {
        type: 'key',
        id: STABLE_ID,
        index: 99,
        name: 'A',
        zIndex: 0,
        hidden: true,
        groupId: 'group-a',
      },
      {
        type: 'stat',
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        index: 88,
        name: 'B',
        zIndex: 1,
        hidden: true,
        groupId: 'group-a',
      },
    ]);

    await act(async () =>
      actions.handleToggleGroupVisibility(click, 'group-a'),
    );

    expect(mocks.setMixedGroupHidden).toHaveBeenCalledWith(
      '4key',
      'group-a',
      false,
    );
    expect(mocks.setGroupHidden).not.toHaveBeenCalled();
    expect(mocks.setGroupHiddenLegacy).not.toHaveBeenCalled();
  });

  it('invalid native group visibility는 fail-closed로 중단한다', async () => {
    await exposeWithItems([
      {
        type: 'key',
        id: 'key-0',
        index: 0,
        name: 'legacy',
        zIndex: 0,
        hidden: false,
        groupId: 'group-a',
      },
    ]);

    await act(async () =>
      actions.handleToggleGroupVisibility(click, 'group-a'),
    );

    expect(mocks.setGroupHiddenLegacy).not.toHaveBeenCalled();
    expect(mocks.setGroupHidden).not.toHaveBeenCalled();
    expect(mocks.setGroupVisibilityViaAuthority).not.toHaveBeenCalled();
    expect(mocks.setMixedGroupHidden).not.toHaveBeenCalled();
  });

  it.each(['key', 'stat', 'graph', 'knob'] as const)(
    'stable %s rename은 index 대신 ID와 trimmed literal을 쓴다',
    async (type) => {
      const item: LayerItem = {
        type,
        id: STABLE_ID,
        index: 99,
        name: 'Before',
        zIndex: 0,
        hidden: false,
      };
      await act(async () => actions.handleLayerRenameCommit(item, '  After  '));

      expect(mocks.patchLayerName).toHaveBeenCalledWith(
        type,
        STABLE_ID,
        'After',
      );
      expect(mocks.patchPropertyViaAuthority).not.toHaveBeenCalled();
    },
  );

  it('invalid native rename은 fail-closed로 어떤 writer도 호출하지 않는다', async () => {
    const item: LayerItem = {
      type: 'key',
      id: 'key-0',
      index: 0,
      name: 'legacy',
      zIndex: 0,
      hidden: false,
    };
    await act(async () => actions.handleLayerRenameCommit(item, 'Legacy'));

    expect(mocks.patchLayerName).not.toHaveBeenCalled();
    expect(mocks.patchPropertyViaAuthority).not.toHaveBeenCalled();
    expect(mocks.updateKeyPositions).not.toHaveBeenCalled();
  });

  it('stable common4 selection group create는 exact create descriptor를 쓴다', async () => {
    const statId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    useGridSelectionStore.setState({
      selectedElements: [
        { type: 'key', id: STABLE_ID, index: 99 },
        { type: 'stat', id: statId, index: 88 },
      ],
    });
    vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    );
    const nextGroups = {
      '4key': [
        {
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          name: 'layerGroup.newGroup 1',
        },
      ],
    };

    await act(async () =>
      actions.setGroupIdOnSelected(
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        undefined,
        { layerGroupsForNormalization: nextGroups },
      ),
    );

    expect(mocks.setMixedElementGroups).toHaveBeenCalledWith(
      '4key',
      [
        { elementType: 'key', id: STABLE_ID },
        { elementType: 'stat', id: statId },
      ],
      [],
      {
        kind: 'create',
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        name: 'layerGroup.newGroup 1',
      },
    );
  });

  it('header ungroup는 클릭 당시 explicit stable children만 null target으로 보낸다', async () => {
    const statId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    await exposeWithItems([
      {
        type: 'key',
        id: STABLE_ID,
        index: 99,
        name: 'A',
        zIndex: 2,
        hidden: false,
        groupId: 'group-a',
      },
      {
        type: 'stat',
        id: statId,
        index: 88,
        name: 'B',
        zIndex: 1,
        hidden: false,
        groupId: 'group-a',
      },
    ]);
    act(() => actions.setContextMenuGroupId('group-a'));
    await act(async () => actions.handleContextMenuSelect('ungroup'));

    expect(mocks.setMixedElementGroups).toHaveBeenCalledWith(
      '4key',
      [
        { elementType: 'key', id: STABLE_ID },
        { elementType: 'stat', id: statId },
      ],
      [],
      null,
    );
  });

  it('invalid native header ungroup는 fail-closed로 중단한다', async () => {
    const position = {
      id: 'key-0',
      dx: 0,
      dy: 0,
      width: 10,
      height: 10,
      groupId: 'group-a',
    };
    useKeyStore.setState({
      canonicalPositions: { '4key': [position] } as never,
      positions: { '4key': [position] } as never,
    });
    useLayerGroupStore.setState({
      layerGroups: { '4key': [{ id: 'group-a', name: 'Group A' }] },
    });
    await exposeWithItems([
      {
        type: 'key',
        id: 'key-0',
        index: 0,
        name: 'legacy',
        zIndex: 0,
        hidden: false,
        groupId: 'group-a',
      },
    ]);
    act(() => actions.setContextMenuGroupId('group-a'));
    await act(async () => actions.handleContextMenuSelect('ungroup'));

    expect(mocks.setElementGroups).not.toHaveBeenCalled();
    expect(mocks.setMixedElementGroups).not.toHaveBeenCalled();
    expect(mocks.setElementGroupsViaAuthority).not.toHaveBeenCalled();
    expect(mocks.commitPatch).not.toHaveBeenCalled();
    expect(useKeyStore.getState().canonicalPositions['4key'][0].groupId).toBe(
      'group-a',
    );
    expect(useLayerGroupStore.getState().layerGroups['4key']).toEqual([
      { id: 'group-a', name: 'Group A' },
    ]);
  });

  it('plugin-only 다중 선택도 groupSelected 메뉴 항목을 활성화한다', async () => {
    useGridSelectionStore.setState({
      selectedElements: [
        { type: 'plugin', id: 'plugin-a:item' },
        { type: 'plugin', id: 'plugin-b:item' },
      ],
    });
    await exposeWithItems([]);

    const pluginOnlyItem = actions.contextMenuItems.find(
      (item) => item.id === 'groupSelected',
    );
    expect(pluginOnlyItem).toBeDefined();
    expect(pluginOnlyItem?.disabled).toBeUndefined();

    useGridSelectionStore.setState({
      selectedElements: [
        { type: 'key', id: STABLE_ID, index: 0 },
        { type: 'plugin', id: 'plugin-a:item' },
      ],
    });
    await exposeWithItems([]);

    const mixedItem = actions.contextMenuItems.find(
      (item) => item.id === 'groupSelected',
    );
    expect(mixedItem).toBeDefined();
    expect(mixedItem?.disabled).toBeUndefined();
  });

  it('plugin 자식이 있는 header ungroup은 mixed 진입점에 fullId를 함께 보낸다', async () => {
    await exposeWithItems([
      {
        type: 'key',
        id: STABLE_ID,
        index: 0,
        name: 'A',
        zIndex: 1,
        hidden: false,
        groupId: 'group-a',
      },
      {
        type: 'plugin',
        id: 'plugin-a::11111111-1111-4111-8111-111111111111',
        name: 'P',
        zIndex: 0,
        hidden: false,
        groupId: 'group-a',
      },
    ]);
    act(() => actions.setContextMenuGroupId('group-a'));
    await act(async () => actions.handleContextMenuSelect('ungroup'));

    expect(mocks.setMixedElementGroups).toHaveBeenCalledWith(
      '4key',
      [{ elementType: 'key', id: STABLE_ID }],
      ['plugin-a::11111111-1111-4111-8111-111111111111'],
      null,
    );
  });

  it('main groupSelected는 plugin 소속 그룹을 재사용한다', async () => {
    const pluginFullId = 'plugin-a::11111111-1111-4111-8111-111111111111';
    useLayerGroupStore.setState({
      layerGroups: { '4key': [{ id: 'group-a', name: 'Group A' }] },
    });
    usePluginDisplayElementStore.setState({
      elements: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          fullId: pluginFullId,
          pluginId: 'plugin-a',
          definitionId: 'plugin-a',
          position: { x: 0, y: 0 },
          tabId: '4key',
          groupId: 'group-a',
        } as never,
      ],
    });
    useGridSelectionStore.setState({
      selectedElements: [
        { type: 'key', id: STABLE_ID, index: 0 },
        { type: 'plugin', id: pluginFullId },
      ],
    });

    await act(async () => actions.handleContextMenuSelect('groupSelected'));

    // 무소속 native + 그룹 G 소속 plugin은 G 재사용 - 새 그룹 생성 아님
    expect(mocks.setMixedElementGroups).toHaveBeenCalledWith(
      '4key',
      [{ elementType: 'key', id: STABLE_ID }],
      [pluginFullId],
      { kind: 'existing', id: 'group-a' },
    );
  });

  it('main 혼합 그룹 가시성 토글은 mixed 진입점 단일 호출로 원자 위임한다', async () => {
    await exposeWithItems([
      {
        type: 'key',
        id: STABLE_ID,
        index: 0,
        name: 'A',
        zIndex: 1,
        hidden: false,
        groupId: 'group-a',
      },
      {
        type: 'plugin',
        id: 'plugin-a::11111111-1111-4111-8111-111111111111',
        name: 'P',
        zIndex: 0,
        hidden: false,
        groupId: 'group-a',
      },
    ]);

    await act(async () =>
      actions.handleToggleGroupVisibility(click, 'group-a'),
    );

    expect(mocks.setMixedGroupHidden).toHaveBeenCalledTimes(1);
    expect(mocks.setMixedGroupHidden).toHaveBeenCalledWith(
      '4key',
      'group-a',
      true,
    );
    // 별도 plugin 커밋 없음 - 히스토리가 2엔트리로 갈라지지 않는다
    expect(mocks.setPluginHidden).not.toHaveBeenCalled();
    expect(mocks.setGroupHidden).not.toHaveBeenCalled();
  });

  it('main plugin-only 그룹 가시성 토글도 mixed 진입점이 판정한다', async () => {
    await exposeWithItems([
      {
        type: 'plugin',
        id: 'plugin-a::11111111-1111-4111-8111-111111111111',
        name: 'P',
        zIndex: 0,
        hidden: true,
        groupId: 'group-a',
      },
    ]);

    await act(async () =>
      actions.handleToggleGroupVisibility(click, 'group-a'),
    );

    expect(mocks.setMixedGroupHidden).toHaveBeenCalledWith(
      '4key',
      'group-a',
      false,
    );
    expect(mocks.setGroupHidden).not.toHaveBeenCalled();
    expect(mocks.setPluginHidden).not.toHaveBeenCalled();
  });

  it('컨텍스트 메뉴는 item·group 상태별 exact 항목 순서를 유지한다', async () => {
    const item: LayerItem = {
      type: 'key',
      id: STABLE_ID,
      index: 0,
      name: 'A',
      zIndex: 0,
      hidden: false,
    };
    const contextEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      clientX: 10,
      clientY: 20,
    } as unknown as React.MouseEvent;

    act(() => actions.handleContextMenu(contextEvent, item, 0));
    expect(actions.contextMenuItems.map(({ id }) => id)).toEqual([
      'rename',
      'delete',
    ]);

    useGridSelectionStore.setState({
      selectedElements: [
        { type: 'key', id: STABLE_ID, index: 0 },
        {
          type: 'stat',
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          index: 0,
        },
      ],
    });
    await exposeWithItems([]);
    act(() => actions.handleContextMenu(contextEvent, item, 0));
    expect(actions.contextMenuItems.map(({ id }) => id)).toEqual([
      'rename',
      'groupSelected',
      'delete',
    ]);

    act(() =>
      actions.handleContextMenu(
        contextEvent,
        { ...item, groupId: 'group-a' },
        0,
      ),
    );
    expect(actions.contextMenuItems.map(({ id }) => id)).toEqual([
      'rename',
      'removeFromGroup',
      'delete',
    ]);

    act(() => actions.handleGroupHeaderContextMenu(contextEvent, 'group-a'));
    expect(actions.contextMenuItems.map(({ id }) => id)).toEqual([
      'renameGroup',
      'ungroup',
    ]);
  });

  it('rename 선택은 먼저 메뉴 상태를 닫고 다음 RAF에 input focus·select를 실행한다', async () => {
    const item: LayerItem = {
      type: 'key',
      id: STABLE_ID,
      index: 0,
      name: 'Layer A',
      zIndex: 0,
      hidden: false,
    };
    const contextEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      clientX: 10,
      clientY: 20,
    } as unknown as React.MouseEvent;
    let scheduled: FrameRequestCallback | undefined;
    const raf = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        scheduled = callback;
        return 1;
      });
    const input = host.querySelector<HTMLInputElement>(
      '[aria-label="rename input"]',
    )!;
    const focus = vi.spyOn(input, 'focus');
    const select = vi.spyOn(input, 'select');

    act(() => actions.handleContextMenu(contextEvent, item, 0));
    await act(async () => actions.handleContextMenuSelect('rename'));

    expect(actions.contextMenuOpen).toBe(false);
    expect(actions.renamingItemId).toBe(STABLE_ID);
    expect(actions.renameValue).toBe('Layer A');
    expect(focus).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();

    act(() => scheduled?.(0));
    expect(focus).toHaveBeenCalledOnce();
    expect(select).toHaveBeenCalledOnce();
    raf.mockRestore();
  });

  it('group ungroup 비동기 실패는 reject를 전파하고 메뉴·group 상태를 열린 채 유지한다', async () => {
    await exposeWithItems([
      {
        type: 'key',
        id: STABLE_ID,
        index: 0,
        name: 'A',
        zIndex: 0,
        hidden: false,
        groupId: 'group-a',
      },
    ]);
    const contextEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      clientX: 10,
      clientY: 20,
    } as unknown as React.MouseEvent;
    const failure = new Error('ungroup failed');
    mocks.setMixedElementGroups.mockRejectedValueOnce(failure);

    act(() => actions.handleGroupHeaderContextMenu(contextEvent, 'group-a'));
    let rejected: unknown;
    await act(async () => {
      try {
        await actions.handleContextMenuSelect('ungroup');
      } catch (error) {
        rejected = error;
      }
    });

    expect(rejected).toBe(failure);
    expect(actions.contextMenuOpen).toBe(true);
    expect(actions.contextMenuItems.map(({ id }) => id)).toEqual([
      'renameGroup',
      'ungroup',
    ]);
  });
});
