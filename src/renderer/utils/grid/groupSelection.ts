/**
 * 캔버스 클릭 시 그룹 멤버 확장 선택 공용 로직
 * Grid.tsx(native 클릭)와 PluginElement.tsx(플러그인 클릭)에서 공유
 */

import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import type { LayerGroupDef } from '@src/types/layerGroups';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';
import { isPluginVisibleInMode } from '@utils/layerGroupUtils';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useSpriteStore } from '@stores/data/useSpriteStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';

// 그룹 판정에 필요한 native 위치 최소 형태 (sprite는 groupId를 null로 저장)
type GroupablePositionLike = { id: string; groupId?: string | null };

// 그룹 판정에 필요한 플러그인 요소 최소 형태
type PluginGroupSelectableLike = Pick<
  PluginDisplayElementInternal,
  'fullId' | 'tabId' | 'groupId'
>;

export interface GroupSelectionSource {
  mode: string;
  keyPositions: readonly (GroupablePositionLike | null | undefined)[];
  statPositions: readonly (GroupablePositionLike | null | undefined)[];
  graphPositions: readonly (GroupablePositionLike | null | undefined)[];
  knobPositions: readonly (GroupablePositionLike | null | undefined)[];
  spritePositions: readonly (GroupablePositionLike | null | undefined)[];
  pluginElements: readonly PluginGroupSelectableLike[];
  // 현재 모드의 그룹 def 목록 - def가 없는 groupId는 확장하지 않는다
  modeGroups: readonly Pick<LayerGroupDef, 'id'>[];
}

export type SelectionGroupingSummary =
  | { kind: 'none' }
  | { kind: 'same'; groupId: string }
  | { kind: 'mixed' };

const nativeCollections = (source: GroupSelectionSource) =>
  ({
    key: source.keyPositions,
    stat: source.statPositions,
    graph: source.graphPositions,
    knob: source.knobPositions,
    sprite: source.spritePositions,
  } as const);

const resolveClickedGroupId = (
  clicked: SelectedElement,
  source: GroupSelectionSource,
): string | undefined => {
  if (clicked.type === 'plugin') {
    return source.pluginElements.find((el) => el.fullId === clicked.id)
      ?.groupId;
  }
  return (
    nativeCollections(source)[clicked.type].find(
      (pos) => pos?.id === clicked.id,
    )?.groupId ?? undefined
  );
};

const resolveSelectionGroupId = (
  element: SelectedElement,
  source: GroupSelectionSource,
  modeGroupIds: ReadonlySet<string>,
): string | undefined => {
  if (element.type === 'plugin') {
    const groupId = source.pluginElements.find(
      (candidate) => candidate.fullId === element.id,
    )?.groupId;
    return groupId && modeGroupIds.has(groupId) ? groupId : undefined;
  }

  return nativeCollections(source)[element.type].find(
    (position) => position?.id === element.id,
  )?.groupId;
};

/**
 * 선택 집합의 그룹 메뉴 상태를 계산한다.
 * native의 기존 dangling groupId는 해제 대상으로 유지하고, plugin은 현재 모드에
 * 정의된 그룹만 유효하게 보는 기존 캔버스 계약을 보존한다.
 */
export const summarizeSelectionGrouping = (
  selectedElements: readonly SelectedElement[],
  source: GroupSelectionSource,
): SelectionGroupingSummary => {
  const modeGroupIds = new Set(source.modeGroups.map((group) => group.id));
  let firstGroupId: string | undefined;
  let anyInGroup = false;
  let allInSameGroup = true;

  selectedElements.forEach((element, index) => {
    const groupId = resolveSelectionGroupId(element, source, modeGroupIds);
    if (groupId) anyInGroup = true;
    if (index === 0) {
      firstGroupId = groupId;
    } else if (groupId !== firstGroupId) {
      allInSameGroup = false;
    }
  });

  if (anyInGroup && allInSameGroup && firstGroupId) {
    return { kind: 'same', groupId: firstGroupId };
  }
  if (!anyInGroup) return { kind: 'none' };
  return { kind: 'mixed' };
};

/**
 * 클릭 요소의 그룹 멤버 전체를 SelectedElement 배열로 확장
 * - 클릭 요소가 항상 선두 (native·플러그인 클릭 공통 계약)
 * - dangling groupId(그룹 def 없음)는 확장하지 않음 (읽기 가드와 동일)
 * - 플러그인 멤버는 현재 모드에서 보이는 것만 포함 (컨텍스트 메뉴 판정과 동일 규칙)
 */
export const expandGroupSelection = (
  clicked: SelectedElement,
  source: GroupSelectionSource,
): SelectedElement[] => {
  const selection: SelectedElement[] = [clicked];
  const groupId = resolveClickedGroupId(clicked, source);
  if (!groupId || !source.modeGroups.some((group) => group.id === groupId)) {
    return selection;
  }

  const collections = nativeCollections(source);
  (['key', 'stat', 'graph', 'knob', 'sprite'] as const).forEach(
    (memberType) => {
      collections[memberType].forEach((pos, index) => {
        if (!pos || pos.groupId !== groupId) return;
        if (clicked.type === memberType && clicked.id === pos.id) return;
        selection.push({ type: memberType, id: pos.id, index });
      });
    },
  );
  source.pluginElements.forEach((el) => {
    if (el.groupId !== groupId) return;
    if (!isPluginVisibleInMode(el, source.mode)) return;
    if (clicked.type === 'plugin' && clicked.id === el.fullId) return;
    selection.push({ type: 'plugin', id: el.fullId });
  });
  return selection;
};

// 스토어 스냅샷 기반 편의 래퍼 - 컬렉션을 직접 들고 있지 않은 호출부용
export const expandGroupSelectionFromStores = (
  clicked: SelectedElement,
  mode: string,
): SelectedElement[] =>
  expandGroupSelection(clicked, {
    mode,
    keyPositions: useKeyStore.getState().positions[mode] || [],
    statPositions: useStatItemStore.getState().positions[mode] || [],
    graphPositions: useGraphItemStore.getState().positions[mode] || [],
    knobPositions: useKnobItemStore.getState().positions[mode] || [],
    spritePositions: useSpriteStore.getState().positions[mode] || [],
    pluginElements: usePluginDisplayElementStore.getState().elements,
    modeGroups: useLayerGroupStore.getState().layerGroups[mode] || [],
  });
