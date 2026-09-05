import { describe, expect, it } from 'vitest';
import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import type { DisplayItem, LayerItem } from '../types';
import {
  layerItemToSelectedElement,
  resolveLayerGroupSelectionIntent,
  resolveLayerItemSelectionIntent,
} from './layerSelectionIntent';

const item = (id: string, index: number, groupId?: string): LayerItem => ({
  type: 'key',
  id,
  index,
  name: id,
  zIndex: 10 - index,
  hidden: false,
  ...(groupId ? { groupId } : {}),
});

const A = item('a', 0);
const B = item('b', 1, 'g');
const C = item('c', 2, 'g');
const D = item('d', 3);
const E = item('e', 4, 'h');
const F = item('f', 5, 'h');
const LAYER_ITEMS = [A, B, C, D, E, F];

const selected = (layerItem: LayerItem): SelectedElement =>
  layerItemToSelectedElement(layerItem);

const expandedDisplay: DisplayItem[] = [
  { displayType: 'layer', item: A, groupDepth: 0, flatIndex: 0 },
  {
    displayType: 'group-header',
    groupId: 'g',
    groupName: 'G',
    isCollapsed: false,
    childCount: 2,
    allHidden: false,
  },
  { displayType: 'layer', item: B, groupDepth: 1, flatIndex: 1 },
  { displayType: 'layer', item: C, groupDepth: 1, flatIndex: 2 },
  { displayType: 'layer', item: D, groupDepth: 0, flatIndex: 3 },
  {
    displayType: 'group-header',
    groupId: 'h',
    groupName: 'H',
    isCollapsed: false,
    childCount: 2,
    allHidden: false,
  },
  { displayType: 'layer', item: E, groupDepth: 1, flatIndex: 4 },
  { displayType: 'layer', item: F, groupDepth: 1, flatIndex: 5 },
];

const collapsedDisplay: DisplayItem[] = [
  expandedDisplay[0],
  { ...expandedDisplay[1], isCollapsed: true } as DisplayItem,
  expandedDisplay[4],
  { ...expandedDisplay[5], isCollapsed: true } as DisplayItem,
];

const resolveItem = (
  overrides: Partial<
    Parameters<typeof resolveLayerItemSelectionIntent>[0]
  > = {},
) =>
  resolveLayerItemSelectionIntent({
    item: A,
    index: 0,
    primary: false,
    shift: false,
    lastClickedIndex: null,
    lastClickedDisplayIndex: null,
    layerItems: LAYER_ITEMS,
    displayItems: expandedDisplay,
    selectedElements: [],
    selectedGroupIds: [],
    ...overrides,
  });

const resolveGroup = (
  overrides: Partial<
    Parameters<typeof resolveLayerGroupSelectionIntent>[0]
  > = {},
) =>
  resolveLayerGroupSelectionIntent({
    groupId: 'g',
    primary: false,
    shift: false,
    lastClickedDisplayIndex: null,
    layerItems: LAYER_ITEMS,
    rangeLayerItems: LAYER_ITEMS,
    displayItems: expandedDisplay,
    selectedElements: [],
    selectedGroupIds: [],
    ...overrides,
  });

describe('resolveLayerItemSelectionIntent', () => {
  it('ordinary 선택 상태별 즉시 교체와 50ms 지연 의도를 구분한다', () => {
    expect(resolveItem().intent).toEqual({
      type: 'replace',
      element: selected(A),
    });
    expect(resolveItem({ selectedElements: [selected(A)] }).intent).toEqual({
      type: 'delay-clear',
    });
    expect(
      resolveItem({ selectedElements: [selected(A), selected(B)] }).intent,
    ).toEqual({ type: 'delay-single', element: selected(A) });
  });

  it('primary는 요소를 토글하면서 기존 groupIds 참조를 유지한다', () => {
    const selectedGroupIds = ['g'];
    const added = resolveItem({
      item: D,
      index: 3,
      primary: true,
      selectedElements: [selected(A)],
      selectedGroupIds,
    });
    expect(added.intent).toEqual({
      type: 'set-full',
      elements: [selected(A), selected(D)],
      groupIds: selectedGroupIds,
    });
    if (added.intent.type !== 'set-full') throw new Error('unexpected intent');
    expect(added.intent.groupIds).toBe(selectedGroupIds);

    expect(
      resolveItem({
        primary: true,
        selectedElements: [selected(A), selected(D)],
      }).intent,
    ).toEqual({
      type: 'set-full',
      elements: [selected(D)],
      groupIds: [],
    });
  });

  it('collapsed display range가 그룹 자식을 포함하고 행 중복을 ID로 제거한다', () => {
    const resolution = resolveItem({
      item: D,
      index: 3,
      shift: true,
      lastClickedIndex: 0,
      lastClickedDisplayIndex: 0,
      displayItems: collapsedDisplay,
    });

    expect(resolution).toEqual({
      intent: {
        type: 'set-full',
        elements: [selected(A), selected(B), selected(C), selected(D)],
        groupIds: ['g'],
      },
      anchor: null,
    });
  });

  it('shift+primary display range는 기존 순서를 유지하며 새 요소·그룹만 붙인다', () => {
    expect(
      resolveItem({
        item: D,
        index: 3,
        primary: true,
        shift: true,
        lastClickedIndex: 0,
        lastClickedDisplayIndex: 0,
        displayItems: collapsedDisplay,
        selectedElements: [selected(F), selected(A)],
        selectedGroupIds: ['h'],
      }).intent,
    ).toEqual({
      type: 'set-full',
      elements: [
        selected(F),
        selected(A),
        selected(B),
        selected(C),
        selected(D),
      ],
      groupIds: ['h', 'g'],
    });
  });

  it('display target이 없으면 flat range fallback과 primary 병합을 사용한다', () => {
    expect(
      resolveItem({
        item: D,
        index: 3,
        shift: true,
        lastClickedIndex: 1,
        lastClickedDisplayIndex: null,
      }).intent,
    ).toEqual({
      type: 'set-elements',
      elements: [selected(B), selected(C), selected(D)],
    });

    expect(
      resolveItem({
        item: D,
        index: 3,
        primary: true,
        shift: true,
        lastClickedIndex: 1,
        lastClickedDisplayIndex: null,
        selectedElements: [selected(A), selected(C)],
      }).intent,
    ).toEqual({
      type: 'set-elements',
      elements: [selected(A), selected(C), selected(B), selected(D)],
    });
  });

  it('ordinary 경로만 다음 flat/display anchor를 갱신한다', () => {
    expect(resolveItem({ item: D, index: 3 }).anchor).toEqual({
      index: 3,
      displayIndex: 4,
    });
    expect(
      resolveItem({
        item: D,
        index: 3,
        shift: true,
        lastClickedIndex: 0,
      }).anchor,
    ).toBeNull();
  });
});

describe('resolveLayerGroupSelectionIntent', () => {
  it('ordinary는 자식과 그룹을 교체하고 primary는 전체 그룹을 추가·제거한다', () => {
    expect(resolveGroup()).toEqual({
      intent: {
        type: 'set-full',
        elements: [selected(B), selected(C)],
        groupIds: ['g'],
      },
      anchor: { index: null, displayIndex: 1 },
    });

    expect(
      resolveGroup({
        primary: true,
        selectedElements: [selected(A), selected(B)],
      }).intent,
    ).toEqual({
      type: 'set-full',
      elements: [selected(A), selected(B), selected(C)],
      groupIds: ['g'],
    });

    expect(
      resolveGroup({
        primary: true,
        selectedElements: [selected(A), selected(B), selected(C)],
        selectedGroupIds: ['g'],
      }).intent,
    ).toEqual({
      type: 'set-full',
      elements: [selected(A)],
      groupIds: [],
    });
  });

  it('group shift와 shift+primary도 같은 display range 병합 규칙을 쓴다', () => {
    expect(
      resolveGroup({
        groupId: 'h',
        shift: true,
        lastClickedDisplayIndex: 1,
      }).intent,
    ).toEqual({
      type: 'set-full',
      elements: [
        selected(B),
        selected(C),
        selected(D),
        selected(E),
        selected(F),
      ],
      groupIds: ['g', 'h'],
    });

    expect(
      resolveGroup({
        groupId: 'h',
        primary: true,
        shift: true,
        lastClickedDisplayIndex: 1,
        selectedElements: [selected(A), selected(C)],
        selectedGroupIds: ['external', 'g'],
      }).intent,
    ).toEqual({
      type: 'set-full',
      elements: [
        selected(A),
        selected(C),
        selected(B),
        selected(D),
        selected(E),
        selected(F),
      ],
      groupIds: ['external', 'g', 'h'],
    });
  });

  it('렌더 모델에 없는 그룹은 선택과 anchor를 모두 건드리지 않는다', () => {
    expect(resolveGroup({ groupId: 'missing' })).toEqual({
      intent: { type: 'none' },
      anchor: null,
    });
  });
});

describe('layerItemToSelectedElement', () => {
  it('plugin은 index를 내보내지 않고 native는 locator index를 유지한다', () => {
    expect(
      layerItemToSelectedElement({
        type: 'plugin',
        id: 'plugin:element',
        index: 9,
        name: 'Plugin',
        zIndex: 0,
        hidden: false,
      }),
    ).toEqual({ type: 'plugin', id: 'plugin:element' });
    expect(layerItemToSelectedElement(B)).toEqual({
      type: 'key',
      id: 'b',
      index: 1,
    });
  });
});
