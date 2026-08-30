// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  didDrag: false,
  isDragging: false,
  mac: false,
  events: [] as string[],
  getDidDrag: vi.fn(() => false),
  resetDidDrag: vi.fn(),
  getIsDraggingRef: vi.fn(() => false),
}));

vi.mock('@components/main/common/IconSwap', () => ({
  default: ({ active }: { active: boolean }) => (
    <span data-active={String(active)} />
  ),
}));

vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'ko', changeLanguage: () => {} },
  }),
}));

vi.mock('@hooks/useLenis', () => ({
  useLenis: () => ({
    scrollContainerRef: () => {},
    lenisInstance: { current: null },
  }),
}));

vi.mock('@utils/core/platform', () => ({
  isMac: () => mocks.mac,
}));

vi.mock('./useLayerDnD', () => ({
  useLayerDnD: () => ({
    draggedItemId: null,
    isDragging: false,
    draggedGroupId: null,
    dragOverItemDisplayIndex: null,
    dragOverIntoGroupId: null,
    dragOverTargetGroupId: null,
    dragOverDisplayIndex: null,
    getDidDrag: mocks.getDidDrag,
    resetDidDrag: mocks.resetDidDrag,
    getIsDraggingRef: mocks.getIsDraggingRef,
    handleMouseDown: vi.fn(),
    handleGroupMouseDown: vi.fn(),
  }),
}));

import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import {
  useGridSelectionStore,
  type SelectedElement,
} from '@stores/grid/useGridSelectionStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import LayerTabContent from './LayerTabContent';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const IDS = {
  a: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  b: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  c: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  d: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  e: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  f: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
} as const;

const GROUP_G = 'group-g';
const GROUP_H = 'group-h';

const selected = (id: string, index: number): SelectedElement => ({
  type: 'key',
  id,
  index,
});

const initialGridState = useGridSelectionStore.getInitialState();

let host: HTMLDivElement;
let root: Root;

const selectionIds = () =>
  useGridSelectionStore
    .getState()
    .selectedElements.map((element) => element.id);

const groupIds = () => useGridSelectionStore.getState().selectedGroupIds;

const findRow = (label: string) => {
  const row = [
    ...host.querySelectorAll<HTMLElement>('.dmn-row-grabbable'),
  ].find((candidate) => candidate.textContent?.includes(label));
  if (!row) throw new Error(`row not found: ${label}`);
  return row;
};

const clickRow = async (
  label: string,
  init: Pick<MouseEventInit, 'ctrlKey' | 'metaKey' | 'shiftKey'> = {},
) => {
  await act(async () => {
    findRow(label).dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, ...init }),
    );
  });
};

const setSelection = async (
  elements: SelectedElement[],
  selectedGroupIds: string[] = [],
) => {
  await act(async () => {
    useGridSelectionStore.setState({
      selectedElements: elements,
      selectedGroupIds,
    });
  });
};

const setCollapsedGroups = async (collapsedGroups: Set<string>) => {
  await act(async () => {
    useLayerGroupStore.setState({ collapsedGroups });
  });
};

const mount = async ({ collapsed = [] }: { collapsed?: string[] } = {}) => {
  useKeyStore.setState({
    selectedKeyType: '4key',
    keyMappings: { '4key': ['A', 'B', 'C', 'D', 'E', 'F'] },
    positions: {
      '4key': [
        {
          id: IDS.a,
          layerName: 'Layer A',
          dx: 0,
          dy: 0,
          width: 60,
          height: 60,
          zIndex: 6,
        },
        {
          id: IDS.b,
          layerName: 'Layer B',
          dx: 0,
          dy: 0,
          width: 60,
          height: 60,
          zIndex: 5,
          groupId: GROUP_G,
        },
        {
          id: IDS.c,
          layerName: 'Layer C',
          dx: 0,
          dy: 0,
          width: 60,
          height: 60,
          zIndex: 4,
          groupId: GROUP_G,
        },
        {
          id: IDS.d,
          layerName: 'Layer D',
          dx: 0,
          dy: 0,
          width: 60,
          height: 60,
          zIndex: 3,
        },
        {
          id: IDS.e,
          layerName: 'Layer E',
          dx: 0,
          dy: 0,
          width: 60,
          height: 60,
          zIndex: 2,
          groupId: GROUP_H,
        },
        {
          id: IDS.f,
          layerName: 'Layer F',
          dx: 0,
          dy: 0,
          width: 60,
          height: 60,
          zIndex: 1,
          groupId: GROUP_H,
        },
      ],
    } as never,
  });
  useStatItemStore.setState({ positions: {} });
  useGraphItemStore.setState({ positions: {} });
  useKnobItemStore.setState({ positions: {} });
  useLayerGroupStore.setState({
    layerGroups: {
      '4key': [
        { id: GROUP_G, name: 'Group G' },
        { id: GROUP_H, name: 'Group H' },
      ],
    },
    collapsedGroups: new Set(collapsed),
  });
  usePluginDisplayElementStore.setState({ elements: [] });
  useGridSelectionStore.setState({
    ...initialGridState,
    selectedElements: [],
    selectedGroupIds: [],
    clearSelection: vi.fn(() => {
      mocks.events.push('clearSelection');
      initialGridState.clearSelection();
    }),
    toggleSelection: vi.fn((element: SelectedElement) => {
      mocks.events.push('toggleSelection');
      initialGridState.toggleSelection(element);
    }),
    setSelectedElements: vi.fn((elements: SelectedElement[]) => {
      mocks.events.push('setSelectedElements');
      initialGridState.setSelectedElements(elements);
    }),
    setFullSelection: vi.fn(
      (elements: SelectedElement[], selectedGroupIds: string[]) => {
        mocks.events.push('setFullSelection');
        initialGridState.setFullSelection(elements, selectedGroupIds);
      },
    ),
  });

  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <LayerTabContent
        onSelectionFromPanel={() => mocks.events.push('callback')}
      />,
    );
  });
};

beforeEach(() => {
  mocks.didDrag = false;
  mocks.isDragging = false;
  mocks.mac = false;
  mocks.events = [];
  mocks.getDidDrag.mockImplementation(() => {
    mocks.events.push('getDidDrag');
    return mocks.didDrag;
  });
  mocks.resetDidDrag.mockImplementation(() => {
    mocks.events.push('resetDidDrag');
    mocks.didDrag = false;
  });
  mocks.getIsDraggingRef.mockImplementation(() => {
    mocks.events.push('getIsDraggingRef');
    return mocks.isDragging;
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('LayerTab item selection intent', () => {
  it('ordinary와 primary 클릭의 선택 교체·추가·제거 계약을 유지한다', async () => {
    await mount();

    await clickRow('Layer A');
    expect(selectionIds()).toEqual([IDS.a]);
    expect(mocks.events).toEqual([
      'getDidDrag',
      'getIsDraggingRef',
      'callback',
      'clearSelection',
      'toggleSelection',
    ]);

    mocks.events = [];
    await clickRow('Layer B', { ctrlKey: true });
    expect(selectionIds()).toEqual([IDS.a, IDS.b]);
    expect(mocks.events).toEqual([
      'getDidDrag',
      'getIsDraggingRef',
      'callback',
      'setFullSelection',
    ]);

    mocks.events = [];
    await clickRow('Layer A', { ctrlKey: true });
    expect(selectionIds()).toEqual([IDS.b]);
    expect(mocks.events.at(-1)).toBe('setFullSelection');
  });

  it('collapsed display range는 숨은 그룹 자식과 그룹 ID를 포함한다', async () => {
    await mount({ collapsed: [GROUP_G, GROUP_H] });

    await clickRow('Layer A');
    await clickRow('Layer D', { shiftKey: true });

    expect(selectionIds()).toEqual([IDS.a, IDS.b, IDS.c, IDS.d]);
    expect(groupIds()).toEqual([GROUP_G]);
    expect(mocks.events.at(-1)).toBe('setFullSelection');
  });

  it('display anchor가 접기 변경으로 초기화되면 flat index fallback을 쓴다', async () => {
    await mount();

    await clickRow('Layer A');
    await setCollapsedGroups(new Set([GROUP_G]));
    mocks.events = [];
    await clickRow('Layer D', { shiftKey: true });

    expect(selectionIds()).toEqual([IDS.a, IDS.b, IDS.c, IDS.d]);
    expect(groupIds()).toEqual([]);
    expect(mocks.events).toEqual([
      'getDidDrag',
      'getIsDraggingRef',
      'callback',
      'setSelectedElements',
    ]);
  });

  it('shift+primary display range는 기존 요소·그룹 뒤에 새 항목만 병합한다', async () => {
    await mount({ collapsed: [GROUP_G, GROUP_H] });

    await clickRow('Layer A');
    await setSelection([selected(IDS.f, 5)], [GROUP_H]);
    mocks.events = [];
    await clickRow('Layer D', { shiftKey: true, ctrlKey: true });

    expect(selectionIds()).toEqual([IDS.f, IDS.a, IDS.b, IDS.c, IDS.d]);
    expect(groupIds()).toEqual([GROUP_H, GROUP_G]);
    expect(mocks.events.at(-1)).toBe('setFullSelection');
  });

  it('macOS에서는 Ctrl click을 callback 뒤에 막고 Meta를 primary로 사용한다', async () => {
    mocks.mac = true;
    await mount();

    await clickRow('Layer A', { ctrlKey: true });
    expect(selectionIds()).toEqual([]);
    expect(mocks.events).toEqual([
      'getDidDrag',
      'getIsDraggingRef',
      'callback',
    ]);

    mocks.events = [];
    await clickRow('Layer A', { metaKey: true });
    expect(selectionIds()).toEqual([IDS.a]);
    expect(mocks.events.at(-1)).toBe('setFullSelection');
  });
});

describe('LayerTab delayed deselection', () => {
  it('selected multi는 50ms 뒤 단일 선택, selected single은 50ms 뒤 해제한다', async () => {
    vi.useFakeTimers();
    await mount();
    // 같은 행 재클릭 계약: 첫 클릭으로 range anchor를 먼저 고정한다.
    await clickRow('Layer B');
    await setSelection([selected(IDS.a, 0), selected(IDS.b, 1)], [GROUP_G]);

    mocks.events = [];
    await clickRow('Layer B');
    expect(selectionIds()).toEqual([IDS.a, IDS.b]);
    await act(async () => vi.advanceTimersByTime(49));
    expect(selectionIds()).toEqual([IDS.a, IDS.b]);
    await act(async () => vi.advanceTimersByTime(1));
    expect(selectionIds()).toEqual([IDS.b]);
    expect(groupIds()).toEqual([]);

    mocks.events = [];
    await clickRow('Layer B');
    await act(async () => vi.advanceTimersByTime(50));
    expect(selectionIds()).toEqual([]);
    expect(mocks.events.at(-1)).toBe('clearSelection');
  });

  it('다른 anchor의 selected 행은 기존 render cleanup이 pending timer를 취소한다', async () => {
    vi.useFakeTimers();
    await mount();
    await setSelection([selected(IDS.a, 0), selected(IDS.b, 1)]);

    await clickRow('Layer B');
    await act(async () => vi.advanceTimersByTime(50));

    expect(selectionIds()).toEqual([IDS.a, IDS.b]);
  });

  it('다음 item click은 pending timer를 먼저 취소한다', async () => {
    vi.useFakeTimers();
    await mount();
    await clickRow('Layer B');
    await setSelection([selected(IDS.a, 0), selected(IDS.b, 1)]);

    mocks.events = [];
    await clickRow('Layer B');
    mocks.mac = true;
    mocks.events = [];
    await clickRow('Layer A', { ctrlKey: true });
    await act(async () => vi.advanceTimersByTime(50));

    expect(selectionIds()).toEqual([IDS.a, IDS.b]);
    expect(mocks.events).toEqual([
      'getDidDrag',
      'getIsDraggingRef',
      'callback',
    ]);
  });
});

describe('LayerTab group selection intent', () => {
  it('ordinary와 primary 클릭의 자식·그룹 선택 추가와 제거를 유지한다', async () => {
    await mount();

    await clickRow('Group G');
    expect(selectionIds()).toEqual([IDS.b, IDS.c]);
    expect(groupIds()).toEqual([GROUP_G]);

    await setSelection([selected(IDS.a, 0), selected(IDS.b, 1)], []);
    await clickRow('Group G', { ctrlKey: true });
    expect(selectionIds()).toEqual([IDS.a, IDS.b, IDS.c]);
    expect(groupIds()).toEqual([GROUP_G]);

    await clickRow('Group G', { ctrlKey: true });
    expect(selectionIds()).toEqual([IDS.a]);
    expect(groupIds()).toEqual([]);
  });

  it('group shift와 shift+primary는 display range를 선택·병합한다', async () => {
    await mount();

    await clickRow('Group G');
    await clickRow('Group H', { shiftKey: true });
    expect(selectionIds()).toEqual([IDS.b, IDS.c, IDS.d, IDS.e, IDS.f]);
    expect(groupIds()).toEqual([GROUP_G, GROUP_H]);

    await clickRow('Group G');
    await setSelection([selected(IDS.a, 0)], ['external-group']);
    await clickRow('Group H', { shiftKey: true, ctrlKey: true });
    expect(selectionIds()).toEqual([IDS.a, IDS.b, IDS.c, IDS.d, IDS.e, IDS.f]);
    expect(groupIds()).toEqual(['external-group', GROUP_G, GROUP_H]);
  });
});

describe('LayerTab drag gate callback order', () => {
  it('trailing click은 item callback 전, group callback 후에 reset하고 선택하지 않는다', async () => {
    await mount();

    mocks.didDrag = true;
    await clickRow('Layer A');
    expect(mocks.events).toEqual(['getDidDrag', 'resetDidDrag']);
    expect(selectionIds()).toEqual([]);

    mocks.events = [];
    mocks.didDrag = true;
    await clickRow('Group G');
    expect(mocks.events).toEqual(['callback', 'getDidDrag', 'resetDidDrag']);
    expect(selectionIds()).toEqual([]);
  });

  it('active drag gate도 item은 callback 전, group은 callback 후에 평가한다', async () => {
    await mount();
    mocks.isDragging = true;

    await clickRow('Layer A');
    expect(mocks.events).toEqual(['getDidDrag', 'getIsDraggingRef']);

    mocks.events = [];
    await clickRow('Group G');
    expect(mocks.events).toEqual([
      'callback',
      'getDidDrag',
      'getIsDraggingRef',
    ]);
  });
});
