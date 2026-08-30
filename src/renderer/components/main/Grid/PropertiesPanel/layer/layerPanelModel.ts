/**
 * 레이어 패널 모델 빌더 — 순수 함수
 * LayerTabContent에서 사용하는 layerItems / displayItems 생성
 */

import { slotDisplayName } from '@utils/keySlot';
import type { KeyMappings } from '@src/types/key/keys';
import type { CanonicalEditorDocumentV1 } from '@src/types/editor';
import type { PluginPanelElementView } from '@src/types/plugin/api';
import type { LayerGroupDef } from '@src/types/layerGroups';
import type { LayerItem, DisplayItem } from '../types';
import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import { isPluginVisibleInMode } from '@utils/layerGroupUtils';

// 요소 종류별 분기 없이 행을 선택 요소로 변환 - 새 종류가 늘어도 여기 한 곳만 지나간다
export function layerItemToSelectedElement(item: LayerItem): SelectedElement {
  if (item.type === 'plugin') return { type: 'plugin', id: item.id };
  return {
    type: item.type,
    id: item.id,
    ...(item.index !== undefined ? { index: item.index } : {}),
  };
}

// ============================================================================
// layerItems 생성
// ============================================================================

interface BuildLayerItemsParams {
  selectedKeyType: string;
  positions: CanonicalEditorDocumentV1['keyPositions'];
  keyMappings: KeyMappings;
  statPositions: CanonicalEditorDocumentV1['statPositions'];
  graphPositions: CanonicalEditorDocumentV1['graphPositions'];
  knobPositions: CanonicalEditorDocumentV1['knobPositions'];
  spritePositions: CanonicalEditorDocumentV1['spritePositions'];
  pluginElements: PluginPanelElementView[];
  layerGroupsForMode: LayerGroupDef[];
}

export function buildLayerItems({
  selectedKeyType,
  positions,
  keyMappings,
  statPositions,
  graphPositions,
  knobPositions,
  spritePositions,
  pluginElements,
  layerGroupsForMode,
}: BuildLayerItemsParams): LayerItem[] {
  const items: LayerItem[] = [];

  // 키 아이템
  const currentPositions = positions[selectedKeyType] || [];
  const currentKeyMappings = keyMappings[selectedKeyType] || [];
  currentPositions.forEach((pos, index) => {
    const slot = currentKeyMappings[index] ?? '';
    const defaultName = slotDisplayName(slot) || `Key ${index + 1}`;
    items.push({
      type: 'key',
      id: pos.id,
      index,
      name: pos.layerName || defaultName,
      zIndex: pos.zIndex ?? index,
      hidden: !!pos.hidden,
      groupId: pos.groupId,
    });
  });

  // 통계 아이템
  const currentStatPositions = statPositions[selectedKeyType] || [];
  currentStatPositions.forEach((pos, index) => {
    const defaultName =
      pos.statType === 'kpsAvg'
        ? 'AVG'
        : pos.statType === 'kpsMax'
        ? 'MAX'
        : pos.statType === 'total'
        ? 'Total'
        : 'KPS';
    items.push({
      type: 'stat',
      id: pos.id,
      index,
      name: pos.layerName || defaultName,
      zIndex: pos.zIndex ?? index,
      hidden: !!pos.hidden,
      groupId: pos.groupId,
    });
  });

  // 그래프 아이템
  const currentGraphPositions = graphPositions[selectedKeyType] || [];
  currentGraphPositions.forEach((pos, index) => {
    const defaultName =
      pos.statType === 'kpsAvg'
        ? 'AVG Graph'
        : pos.statType === 'kpsMax'
        ? 'MAX Graph'
        : pos.statType === 'total'
        ? 'Total Graph'
        : 'KPS Graph';
    items.push({
      type: 'graph',
      id: pos.id,
      index,
      name: pos.layerName || defaultName,
      zIndex: pos.zIndex ?? index,
      hidden: !!pos.hidden,
      groupId: pos.groupId,
    });
  });

  // 노브 아이템
  const currentKnobPositions = knobPositions[selectedKeyType] || [];
  currentKnobPositions.forEach((pos, index) => {
    items.push({
      type: 'knob',
      id: pos.id,
      index,
      name: pos.layerName || `Knob ${index + 1}`,
      zIndex: pos.zIndex ?? index,
      hidden: !!pos.hidden,
      groupId: pos.groupId,
    });
  });

  // 스프라이트 아이템
  const currentSpritePositions = spritePositions[selectedKeyType] || [];
  currentSpritePositions.forEach((pos, index) => {
    items.push({
      type: 'sprite',
      id: pos.id,
      index,
      name: pos.layerName || `Sprite ${index + 1}`,
      zIndex: pos.zIndex ?? index,
      hidden: !!pos.hidden,
      groupId: pos.groupId ?? undefined,
    });
  });

  // 플러그인 아이템 - 그룹은 모드 스코프라 현재 모드에 def가 있는 groupId만
  // 노출 (dangling group_id의 유령 헤더 방지)
  const validGroupIds = new Set(layerGroupsForMode.map((group) => group.id));
  pluginElements
    .filter((el) => isPluginVisibleInMode(el, selectedKeyType))
    .forEach((el) => {
      items.push({
        type: 'plugin',
        id: el.fullId,
        name: el.definitionId || 'Plugin',
        zIndex: el.zIndex ?? 0,
        hidden: !!el.hidden,
        groupId:
          el.groupId && validGroupIds.has(el.groupId) ? el.groupId : undefined,
      });
    });

  // z-index 내림차순 정렬
  items.sort((a, b) => b.zIndex - a.zIndex);

  return items;
}

// ============================================================================
// displayItems 생성
// ============================================================================

interface BuildDisplayItemsParams {
  layerItems: LayerItem[];
  layerGroupsForMode: LayerGroupDef[];
  collapsedGroups: Set<string>;
  defaultGroupName: string;
}

export function buildDisplayItems({
  layerItems,
  layerGroupsForMode,
  collapsedGroups,
  defaultGroupName,
}: BuildDisplayItemsParams): DisplayItem[] {
  const result: DisplayItem[] = [];
  const seenGroups = new Set<string>();

  // 그룹별 자식 아이템 사전 수집
  const groupChildren = new Map<string, LayerItem[]>();
  layerItems.forEach((item) => {
    if (item.groupId) {
      const children = groupChildren.get(item.groupId) || [];
      children.push(item);
      groupChildren.set(item.groupId, children);
    }
  });

  let flatIdx = 0;
  layerItems.forEach((item) => {
    if (item.groupId) {
      if (!seenGroups.has(item.groupId)) {
        seenGroups.add(item.groupId);
        const groupDef = layerGroupsForMode.find((g) => g.id === item.groupId);
        const children = groupChildren.get(item.groupId) || [];
        const isCollapsed = collapsedGroups.has(item.groupId);
        const allHidden = children.every((c) => c.hidden);

        result.push({
          displayType: 'group-header',
          groupId: item.groupId,
          groupName: groupDef?.name || defaultGroupName,
          isCollapsed,
          childCount: children.length,
          allHidden,
        });

        if (!isCollapsed) {
          children.forEach((child) => {
            const childFlatIdx = layerItems.indexOf(child);
            result.push({
              displayType: 'layer',
              item: child,
              groupDepth: 1,
              flatIndex: childFlatIdx,
            });
          });
        }
      }
    } else {
      result.push({
        displayType: 'layer',
        item,
        groupDepth: 0,
        flatIndex: flatIdx,
      });
    }
    flatIdx++;
  });

  return result;
}
