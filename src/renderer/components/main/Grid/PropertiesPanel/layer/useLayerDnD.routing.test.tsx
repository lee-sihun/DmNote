import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLayerDnD } from './useLayerDnD';

import type { DisplayItem, LayerItem } from '../types';

const mocks = vi.hoisted(() => ({
  runElementIntent: vi.fn(
    (_options: unknown): Promise<unknown> =>
      Promise.resolve({ committed: true }),
  ),
  reportElementOpError: vi.fn(),
  reportElementOpSkipped: vi.fn(),
  setPluginZIndexes: vi.fn(),
  commitPatch: vi.fn(() => Promise.resolve()),
  setKeyPositions: vi.fn(),
  setLayerGroups: vi.fn(),
  selectedElements: [] as Array<{ id: string }>,
  selectedGroupIds: [] as string[],
  commitLayerDropIntent: vi.fn(() => Promise.resolve()),
  reorderViaAuthority: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('@src/renderer/editor/runtime/elementIntent', () => ({
  runElementIntent: mocks.runElementIntent,
  intentPatch: (patch: unknown) =>
    patch === null ? { kind: 'targetLost' } : { kind: 'patch', patch },
  reportElementOpError: mocks.reportElementOpError,
  reportElementOpSkipped: mocks.reportElementOpSkipped,
}));

vi.mock('@plugins/rpc/pluginElementActions', () => ({
  setPluginElementZIndexes: mocks.setPluginZIndexes,
  reorderLayerSelectionViaAuthority: mocks.reorderViaAuthority,
}));

vi.mock('@src/renderer/editor/runtime/editorStateCoordinator', () => ({
  editorCoordinator: {
    commitPatch: mocks.commitPatch,
    getState: () => ({ lastAck: null }),
  },
}));

vi.mock('./layerReorderIntent', () => ({
  commitLayerDropIntent: mocks.commitLayerDropIntent,
  resolveDropIndexFromAnchors: (
    target: {
      toDisplayIndex: number;
      anchorBeforeId?: string | null;
      anchorAfterId?: string | null;
    },
    draggedSet: ReadonlySet<string>,
    display: DisplayItem[],
  ) => {
    const before = target.anchorBeforeId
      ? display.findIndex(
          (item) =>
            item.displayType === 'layer' &&
            item.item.id === target.anchorBeforeId &&
            !draggedSet.has(item.item.id),
        )
      : -1;
    const after = target.anchorAfterId
      ? display.findIndex(
          (item) =>
            item.displayType === 'layer' &&
            item.item.id === target.anchorAfterId &&
            !draggedSet.has(item.item.id),
        )
      : -1;
    if (before >= 0 && after >= 0) return before < after ? before + 1 : null;
    if (before >= 0) return before + 1;
    if (after >= 0) return after;
    return target.toDisplayIndex;
  },
}));

vi.mock('@stores/data/useKeyStore', () => ({
  registerRenderedPositionsComposer: vi.fn(),
  useKeyStore: {
    getState: () => ({
      canonicalPositions: { '4key': [] },
      setPositions: mocks.setKeyPositions,
    }),
  },
}));
vi.mock('@stores/data/useStatItemStore', () => ({
  useStatItemStore: {
    getState: () => ({ positions: { '4key': [] }, setPositions: vi.fn() }),
  },
}));
vi.mock('@stores/data/useGraphItemStore', () => ({
  useGraphItemStore: {
    getState: () => ({ positions: { '4key': [] }, setPositions: vi.fn() }),
  },
}));
vi.mock('@stores/data/useKnobItemStore', () => ({
  useKnobItemStore: {
    getState: () => ({ positions: { '4key': [] }, setPositions: vi.fn() }),
  },
}));
vi.mock('@stores/data/useLayerGroupStore', () => ({
  useLayerGroupStore: {
    getState: () => ({
      layerGroups: {},
      collapsedGroups: new Set(),
      setLayerGroups: mocks.setLayerGroups,
    }),
  },
}));
vi.mock('@stores/grid/useGridSelectionStore', () => ({
  useGridSelectionStore: {
    subscribe: vi.fn(() => vi.fn()),
    getState: () => ({
      selectedElements: mocks.selectedElements,
      selectedGroupIds: mocks.selectedGroupIds,
    }),
  },
}));
vi.mock('@utils/layerGroupUtils', () => ({
  normalizeLayerGroupsForMode: (input: {
    keyPositions: unknown;
    statPositions: unknown;
    graphPositions: unknown;
    knobPositions: unknown;
    layerGroups: unknown;
  }) => ({ ...input, groupsChanged: false }),
}));

const ID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const nativeItem = (
  id: string,
  index: number,
  zIndex: number,
  groupId?: string,
): LayerItem => ({
  type: 'key',
  id,
  index,
  name: `key-${index}`,
  zIndex,
  hidden: false,
  ...(groupId ? { groupId } : {}),
});

const headerRow = (groupId: string, childCount: number): DisplayItem => ({
  displayType: 'group-header',
  groupId,
  groupName: groupId,
  isCollapsed: false,
  childCount,
  allHidden: false,
});

const pluginItem = (fullId: string, zIndex: number): LayerItem => ({
  type: 'plugin',
  id: fullId,
  name: fullId,
  zIndex,
  hidden: false,
});

const toDisplay = (items: LayerItem[]): DisplayItem[] =>
  items.map((item, flatIndex) => ({
    displayType: 'layer' as const,
    item,
    groupDepth: 0,
    flatIndex,
  }));

type DnDApi = ReturnType<typeof useLayerDnD>;

interface HarnessProps {
  layerItems: LayerItem[];
  displayItems?: DisplayItem[];
  buildLiveLayerModel: () => {
    layerItems: LayerItem[];
    displayItems: DisplayItem[];
  };
  expose: (api: DnDApi) => void;
}

const Harness = ({
  layerItems,
  displayItems,
  buildLiveLayerModel,
  expose,
}: HarnessProps) => {
  const layerItemsRef = React.useRef<LayerItem[]>(layerItems);
  const displayItemsRef = React.useRef<DisplayItem[]>(
    displayItems ?? toDisplay(layerItems),
  );
  const scrollElementRef = React.useRef<HTMLDivElement | null>({
    getBoundingClientRect: () => ({
      top: 0,
      bottom: 1000,
      left: 0,
      right: 100,
    }),
    scrollTop: 0,
  } as unknown as HTMLDivElement);
  const api = useLayerDnD({
    selectedKeyType: '4key',
    layerItemsRef,
    displayItemsRef,
    buildLiveLayerModel,
    scrollElementRef,
    clearPendingDeselect: () => {},
  });
  expose(api);
  return null;
};

describe('useLayerDnD 커밋 경로 라우팅', () => {
  let host: HTMLDivElement;
  let root: Root;
  let api: DnDApi;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    mocks.runElementIntent.mockClear();
    // 러너 계약 재현: eager 적용 후 커밋 성공
    mocks.runElementIntent.mockImplementation((options: unknown) => {
      (options as { applyEager: () => unknown }).applyEager();
      return Promise.resolve({ committed: true });
    });
    mocks.reportElementOpError.mockClear();
    mocks.reportElementOpSkipped.mockClear();
    mocks.setPluginZIndexes.mockClear();
    mocks.commitPatch.mockClear();
    mocks.setKeyPositions.mockClear();
    mocks.setLayerGroups.mockClear();
    mocks.selectedElements = [];
    mocks.selectedGroupIds = [];
    mocks.commitLayerDropIntent.mockClear();
    mocks.reorderViaAuthority.mockClear();
    window.__dmn_window_type = 'main';
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  // 아이템 A를 목록 끝으로 드래그하는 공용 시퀀스
  const dragItemToEnd = async (
    layerItems: LayerItem[],
    liveModel: { layerItems: LayerItem[]; displayItems: DisplayItem[] },
  ) => {
    await act(async () => {
      root.render(
        <Harness
          layerItems={layerItems}
          buildLiveLayerModel={() => liveModel}
          expose={(nextApi) => {
            api = nextApi;
          }}
        />,
      );
    });

    await act(async () => {
      api.handleMouseDown(
        {
          button: 0,
          clientX: 0,
          clientY: 10,
          currentTarget: {
            getBoundingClientRect: () => ({ height: 24 }),
          },
        } as unknown as React.MouseEvent,
        layerItems[0],
        0,
      );
      document.dispatchEvent(
        new MouseEvent('mousemove', { clientX: 0, clientY: 200 }),
      );
      document.dispatchEvent(new MouseEvent('mouseup'));
    });
  };

  it('plugin 포함 native 드롭도 id 의도 러너로 커밋하고 full-record를 보내지 않는다', async () => {
    const startItems = [nativeItem(ID_A, 0, 2), nativeItem(ID_B, 1, 1)];
    // 드래그 중 plugin 요소가 추가된 라이브 모델
    const liveItems = [...startItems, pluginItem('plugin-x:one', 0)];
    await dragItemToEnd(startItems, {
      layerItems: liveItems,
      displayItems: toDisplay(liveItems),
    });

    expect(mocks.commitLayerDropIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'items',
        mode: '4key',
        draggedIds: [ID_A],
      }),
    );
    expect(mocks.commitPatch).not.toHaveBeenCalled();
    expect(mocks.setPluginZIndexes).not.toHaveBeenCalled();
  });

  it('panel stable 드롭은 exact descriptor를 main authority로 위임한다', async () => {
    window.__dmn_window_type = 'panel';
    const startItems = [nativeItem(ID_A, 0, 2), nativeItem(ID_B, 1, 1)];
    await dragItemToEnd(startItems, {
      layerItems: startItems,
      displayItems: toDisplay(startItems),
    });

    expect(mocks.commitLayerDropIntent).not.toHaveBeenCalled();
    expect(mocks.reorderViaAuthority).toHaveBeenCalledWith({
      kind: 'items',
      mode: '4key',
      draggedIds: [ID_A],
      preserveFullGroups: false,
      collapsedGroupIds: [],
      anchors: {
        toDisplayIndex: expect.any(Number),
        targetGroupId: null,
        anchorBeforeId: expect.anything(),
        anchorAfterId: null,
        anchorHeaderGroupId: null,
        anchorBeforeHeaderGroupId: null,
        anchorAfterHeaderGroupId: null,
        boundary: null,
      },
    });
  });

  it('native 전용 편입 전 실패는 runner가 소유하고 layerGroups는 eager를 건드리지 않는다', async () => {
    mocks.runElementIntent.mockImplementation((options: unknown) => {
      // 러너 계약 재현: eager 적용 후 편입 전 실패
      (options as { applyEager: () => unknown }).applyEager();
      return Promise.reject(new Error('start failed'));
    });
    const startItems = [nativeItem(ID_A, 0, 1), nativeItem(ID_B, 1, 0)];
    await dragItemToEnd(startItems, {
      layerItems: startItems,
      displayItems: toDisplay(startItems),
    });

    expect(mocks.commitLayerDropIntent).toHaveBeenCalledOnce();
    expect(mocks.setLayerGroups).not.toHaveBeenCalled();
    expect(mocks.setKeyPositions).not.toHaveBeenCalled();
    expect(mocks.commitPatch).not.toHaveBeenCalled();
  });

  const ID_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const ID_X = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const ID_Y = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const ID_M1 = '11111111-1111-4111-8111-111111111111';
  const ID_M2 = '22222222-2222-4222-8222-222222222222';

  const renderDnD = async (props: {
    layerItems: LayerItem[];
    displayItems?: DisplayItem[];
    liveModel: { layerItems: LayerItem[]; displayItems: DisplayItem[] };
  }) => {
    await act(async () => {
      root.render(
        <Harness
          layerItems={props.layerItems}
          displayItems={props.displayItems}
          buildLiveLayerModel={() => props.liveModel}
          expose={(nextApi) => {
            api = nextApi;
          }}
        />,
      );
    });
  };

  const mouseDownEvent = () =>
    ({
      button: 0,
      clientX: 0,
      clientY: 10,
      currentTarget: {
        getBoundingClientRect: () => ({ height: 24 }),
      },
    } as unknown as React.MouseEvent);

  const finishDrag = async (start: () => void, moveClientY: number) => {
    await act(async () => {
      start();
      document.dispatchEvent(
        new MouseEvent('mousemove', { clientX: 0, clientY: moveClientY }),
      );
      document.dispatchEvent(new MouseEvent('mouseup'));
    });
  };

  it('main 합성 항목 드래그도 semantic과 legacy writer를 모두 막는다', async () => {
    const syntheticItem: LayerItem = {
      type: 'key',
      id: 'key-0',
      index: 0,
      name: 'legacy',
      zIndex: 1,
      hidden: false,
    };
    const itemB = nativeItem(ID_B, 1, 0);
    const startItems = [syntheticItem, itemB];
    await dragItemToEnd(startItems, {
      layerItems: startItems,
      displayItems: toDisplay(startItems),
    });

    expect(mocks.reorderViaAuthority).not.toHaveBeenCalled();
    expect(mocks.commitLayerDropIntent).not.toHaveBeenCalled();
    expect(mocks.runElementIntent).not.toHaveBeenCalled();
    expect(mocks.setPluginZIndexes).not.toHaveBeenCalled();
    expect(mocks.commitPatch).not.toHaveBeenCalled();
    expect(mocks.reportElementOpSkipped).toHaveBeenCalledWith(
      'layer drop (invalid native id)',
    );
  });

  it('panel 합성 항목 드래그는 authority와 local writer를 모두 막는다', async () => {
    window.__dmn_window_type = 'panel';
    const syntheticItem: LayerItem = {
      type: 'key',
      id: 'key-0',
      index: 0,
      name: 'legacy',
      zIndex: 1,
      hidden: false,
    };
    const itemB = nativeItem(ID_B, 1, 0);
    const startItems = [syntheticItem, itemB];
    await dragItemToEnd(startItems, {
      layerItems: startItems,
      displayItems: toDisplay(startItems),
    });

    expect(mocks.reorderViaAuthority).not.toHaveBeenCalled();
    expect(mocks.commitLayerDropIntent).not.toHaveBeenCalled();
    expect(mocks.runElementIntent).not.toHaveBeenCalled();
    expect(mocks.setPluginZIndexes).not.toHaveBeenCalled();
    expect(mocks.commitPatch).not.toHaveBeenCalled();
    expect(mocks.reportElementOpSkipped).toHaveBeenCalledWith(
      'layer drop (invalid native id)',
    );
  });

  it('panel 합성 그룹 드래그도 local writer 없이 중단한다', async () => {
    window.__dmn_window_type = 'panel';
    const synthetic = nativeItem('key-0', 0, 2, 'G');
    const itemB = nativeItem(ID_B, 1, 1);
    const items = [synthetic, itemB];
    const display: DisplayItem[] = [
      headerRow('G', 1),
      { displayType: 'layer', item: synthetic, groupDepth: 1, flatIndex: 0 },
      { displayType: 'layer', item: itemB, groupDepth: 0, flatIndex: 1 },
    ];
    await renderDnD({
      layerItems: items,
      displayItems: display,
      liveModel: { layerItems: items, displayItems: display },
    });
    await finishDrag(
      () => api.handleGroupMouseDown(mouseDownEvent(), 'G'),
      200,
    );

    expect(mocks.reorderViaAuthority).not.toHaveBeenCalled();
    expect(mocks.commitLayerDropIntent).not.toHaveBeenCalled();
    expect(mocks.runElementIntent).not.toHaveBeenCalled();
    expect(mocks.setPluginZIndexes).not.toHaveBeenCalled();
    expect(mocks.commitPatch).not.toHaveBeenCalled();
    expect(mocks.reportElementOpSkipped).toHaveBeenCalledWith(
      'group drop (invalid native id)',
    );
  });

  it('plugin-only 드롭은 editor를 커밋하지 않는다', async () => {
    const pluginA = pluginItem('plugin-x:one', 1);
    const pluginB = pluginItem('plugin-y:one', 0);
    const startItems = [pluginA, pluginB];
    await dragItemToEnd(startItems, {
      layerItems: startItems,
      displayItems: toDisplay(startItems),
    });

    expect(mocks.commitLayerDropIntent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'items', draggedIds: ['plugin-x:one'] }),
    );
    expect(mocks.setPluginZIndexes).not.toHaveBeenCalled();
    expect(mocks.runElementIntent).not.toHaveBeenCalled();
    expect(mocks.commitPatch).not.toHaveBeenCalled();
  });

  it('외부 재정렬 후 드롭은 최신 순서 기준으로 커밋한다', async () => {
    const itemA = nativeItem(ID_A, 0, 2);
    const itemB = nativeItem(ID_B, 1, 1);
    const itemC = nativeItem(ID_C, 2, 0);
    // 드래그 중 외부 재정렬로 B·C 순서 교체
    const liveItems = [itemA, itemC, itemB];
    await renderDnD({
      layerItems: [itemA, itemB, itemC],
      liveModel: { layerItems: liveItems, displayItems: toDisplay(liveItems) },
    });

    await finishDrag(
      () => api.handleMouseDown(mouseDownEvent(), itemA, 0),
      200,
    );

    expect(mocks.commitLayerDropIntent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'items', draggedIds: [ID_A] }),
    );
  });

  it('그룹+추가 선택 드래그는 mouseup 시점 live 구성원 전체를 함께 옮긴다', async () => {
    const itemA = nativeItem(ID_A, 0, 3, 'G');
    const itemX = nativeItem(ID_X, 1, 2);
    const itemY = nativeItem(ID_Y, 2, 1);
    // 드래그 중 외부 변경으로 B가 G에 합류
    const itemB = nativeItem(ID_B, 3, 0, 'G');
    const liveItems = [itemA, itemB, itemX, itemY];
    const liveDisplay: DisplayItem[] = [
      headerRow('G', 2),
      { displayType: 'layer', item: itemA, groupDepth: 1, flatIndex: 0 },
      { displayType: 'layer', item: itemB, groupDepth: 1, flatIndex: 1 },
      { displayType: 'layer', item: itemX, groupDepth: 0, flatIndex: 2 },
      { displayType: 'layer', item: itemY, groupDepth: 0, flatIndex: 3 },
    ];
    mocks.selectedGroupIds = ['G'];
    mocks.selectedElements = [{ id: ID_A }, { id: ID_X }];
    await renderDnD({
      layerItems: [itemA, itemX, itemY],
      displayItems: [
        headerRow('G', 1),
        { displayType: 'layer', item: itemA, groupDepth: 1, flatIndex: 0 },
        { displayType: 'layer', item: itemX, groupDepth: 0, flatIndex: 1 },
        { displayType: 'layer', item: itemY, groupDepth: 0, flatIndex: 2 },
      ],
      liveModel: { layerItems: liveItems, displayItems: liveDisplay },
    });

    await finishDrag(
      () => api.handleGroupMouseDown(mouseDownEvent(), 'G'),
      200,
    );

    expect(mocks.commitLayerDropIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'group',
        groupId: 'G',
        extraIds: [ID_X],
      }),
    );
  });

  it('추가 선택이 앵커 후보였던 드롭도 살아있는 비이동 앵커 기준으로 배치한다', async () => {
    const itemA = nativeItem(ID_A, 0, 3, 'G');
    const itemX = nativeItem(ID_X, 1, 2);
    const itemY = nativeItem(ID_Y, 2, 1);
    const itemZ = nativeItem(ID_B, 3, 0);
    const staleDisplay: DisplayItem[] = [
      headerRow('G', 1),
      { displayType: 'layer', item: itemA, groupDepth: 1, flatIndex: 0 },
      { displayType: 'layer', item: itemX, groupDepth: 0, flatIndex: 1 },
      { displayType: 'layer', item: itemY, groupDepth: 0, flatIndex: 2 },
      { displayType: 'layer', item: itemZ, groupDepth: 0, flatIndex: 3 },
    ];
    // 드래그 중 외부 재정렬로 비이동 Y·Z 순서 교체
    const liveItems = [itemA, itemX, itemZ, itemY];
    const liveDisplay: DisplayItem[] = [
      headerRow('G', 1),
      { displayType: 'layer', item: itemA, groupDepth: 1, flatIndex: 0 },
      { displayType: 'layer', item: itemX, groupDepth: 0, flatIndex: 1 },
      { displayType: 'layer', item: itemZ, groupDepth: 0, flatIndex: 2 },
      { displayType: 'layer', item: itemY, groupDepth: 0, flatIndex: 3 },
    ];
    mocks.selectedGroupIds = ['G'];
    mocks.selectedElements = [{ id: ID_A }, { id: ID_X }];
    await renderDnD({
      layerItems: [itemA, itemX, itemY, itemZ],
      displayItems: staleDisplay,
      liveModel: { layerItems: liveItems, displayItems: liveDisplay },
    });

    // X와 Y 사이 슬롯(display 3) - 함께 이동하는 X는 앵커가 될 수 없고
    // 살아있는 비이동 앵커 Y 기준으로 해석돼야 한다
    await finishDrag(() => api.handleGroupMouseDown(mouseDownEvent(), 'G'), 74);

    expect(mocks.commitLayerDropIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'group',
        groupId: 'G',
        extraIds: [ID_X],
      }),
    );
  });

  it('캡처 후 선택 축소로 이동 집합이 줄면 무커밋한다', async () => {
    // 표시 순서 [X, Y, headerG, A], 선택 G+X - G를 최상단으로 드래그
    const itemX = nativeItem(ID_X, 0, 3);
    const itemY = nativeItem(ID_Y, 1, 2);
    const itemA = nativeItem(ID_A, 2, 1, 'G');
    const layerItems = [itemX, itemY, itemA];
    const display: DisplayItem[] = [
      { displayType: 'layer', item: itemX, groupDepth: 0, flatIndex: 0 },
      { displayType: 'layer', item: itemY, groupDepth: 0, flatIndex: 1 },
      headerRow('G', 1),
      { displayType: 'layer', item: itemA, groupDepth: 1, flatIndex: 2 },
    ];
    mocks.selectedGroupIds = ['G'];
    mocks.selectedElements = [{ id: ID_A }, { id: ID_X }];
    await renderDnD({
      layerItems,
      displayItems: display,
      liveModel: { layerItems, displayItems: display },
    });

    await act(async () => {
      api.handleGroupMouseDown(mouseDownEvent(), 'G');
      // 최상단 슬롯 - X는 이동 예정이라 앵커에서 제외되고 after=Y만 캡처
      document.dispatchEvent(
        new MouseEvent('mousemove', { clientX: 0, clientY: 2 }),
      );
      // mouseup 전 원격 동기화로 X만 선택 해제
      mocks.selectedElements = [{ id: ID_A }];
      document.dispatchEvent(new MouseEvent('mouseup'));
    });

    // X 잔류를 앵커가 모르는 채 해석하면 [X, A, Y] 오배치 - 무커밋이어야 한다
    expect(mocks.commitLayerDropIntent).not.toHaveBeenCalled();
    expect(mocks.commitPatch).not.toHaveBeenCalled();
  });

  it('드래그 중 원본 그룹이 소실되면 잔존 선택만 이동시키지 않는다', async () => {
    const itemA = nativeItem(ID_A, 0, 2, 'G');
    const itemX = nativeItem(ID_X, 1, 1);
    const itemY = nativeItem(ID_Y, 2, 0);
    const staleDisplay: DisplayItem[] = [
      headerRow('G', 1),
      { displayType: 'layer', item: itemA, groupDepth: 1, flatIndex: 0 },
      { displayType: 'layer', item: itemX, groupDepth: 0, flatIndex: 1 },
      { displayType: 'layer', item: itemY, groupDepth: 0, flatIndex: 2 },
    ];
    // 드래그 중 G 해체 - A가 그룹 밖으로
    const ungroupedA = nativeItem(ID_A, 0, 2);
    const liveItems = [ungroupedA, itemX, itemY];
    mocks.selectedGroupIds = ['G'];
    mocks.selectedElements = [{ id: ID_A }, { id: ID_X }];
    await renderDnD({
      layerItems: [itemA, itemX, itemY],
      displayItems: staleDisplay,
      liveModel: { layerItems: liveItems, displayItems: toDisplay(liveItems) },
    });

    await finishDrag(
      () => api.handleGroupMouseDown(mouseDownEvent(), 'G'),
      200,
    );

    expect(mocks.commitLayerDropIntent).not.toHaveBeenCalled();
    expect(mocks.commitPatch).not.toHaveBeenCalled();
  });

  it('드롭 대상 그룹 소실 판정을 stable semantic helper에 위임한다', async () => {
    const itemA = nativeItem(ID_A, 0, 3, 'G');
    const itemX = nativeItem(ID_X, 1, 2);
    const itemM1 = nativeItem(ID_M1, 2, 1, 'H');
    const itemM2 = nativeItem(ID_M2, 3, 0, 'H');
    const staleDisplay: DisplayItem[] = [
      headerRow('G', 1),
      { displayType: 'layer', item: itemA, groupDepth: 1, flatIndex: 0 },
      { displayType: 'layer', item: itemX, groupDepth: 0, flatIndex: 1 },
      headerRow('H', 2),
      { displayType: 'layer', item: itemM1, groupDepth: 1, flatIndex: 2 },
      { displayType: 'layer', item: itemM2, groupDepth: 1, flatIndex: 3 },
    ];
    // 드래그 중 H 그룹 전체 삭제
    const liveItems = [itemA, itemX];
    const liveDisplay: DisplayItem[] = [
      headerRow('G', 1),
      { displayType: 'layer', item: itemA, groupDepth: 1, flatIndex: 0 },
      { displayType: 'layer', item: itemX, groupDepth: 0, flatIndex: 1 },
    ];
    mocks.selectedGroupIds = ['G'];
    mocks.selectedElements = [{ id: ID_A }, { id: ID_X }];
    await renderDnD({
      layerItems: [itemA, itemX, itemM1, itemM2],
      displayItems: staleDisplay,
      liveModel: { layerItems: liveItems, displayItems: liveDisplay },
    });

    // m1과 m2 사이 슬롯(display 5)으로 드롭 - 앵커가 전부 H 소속
    await finishDrag(
      () => api.handleGroupMouseDown(mouseDownEvent(), 'G'),
      126,
    );

    expect(mocks.commitLayerDropIntent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'group', mode: '4key', groupId: 'G' }),
    );
    expect(mocks.commitPatch).not.toHaveBeenCalled();
  });
});
