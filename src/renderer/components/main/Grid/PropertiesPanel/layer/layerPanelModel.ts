/**
 * 레이어 패널 모델 빌더 — 순수 함수
 * LayerTabContent에서 사용하는 layerItems / displayItems 생성
 */

import { getKeyInfoByGlobalKey } from '@utils/core/KeyMaps';
import type { KeyMappings, KeyPositions } from '@src/types/key/keys';
import type { StatItemPositions } from '@src/types/key/statItems';
import type { GraphItemPositions } from '@src/types/key/graphItems';
import type { KnobItemPositions } from '@src/types/key/knobs';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';
import type { LayerGroupDef } from '@src/types/layerGroups';
import type { LayerItem, DisplayItem } from '../types';

// ============================================================================
// layerItems 생성
// ============================================================================

interface BuildLayerItemsParams {
  selectedKeyType: string;
  positions: KeyPositions;
  keyMappings: KeyMappings;
  statPositions: StatItemPositions;
  graphPositions: GraphItemPositions;
  knobPositions: KnobItemPositions;
  pluginElements: PluginDisplayElementInternal[];
}

export function buildLayerItems({
  selectedKeyType,
  positions,
  keyMappings,
  statPositions,
  graphPositions,
  knobPositions,
  pluginElements,
}: BuildLayerItemsParams): LayerItem[] {
  const items: LayerItem[] = [];

  // 키 아이템
  const currentPositions = positions[selectedKeyType] || [];
  const currentKeyMappings = keyMappings[selectedKeyType] || [];
  currentPositions.forEach((pos, index) => {
    const keyCode = currentKeyMappings[index] || '';
    const keyInfo = keyCode ? getKeyInfoByGlobalKey(keyCode) : null;
    const defaultName = keyInfo?.displayName || keyCode || `Key ${index + 1}`;
    items.push({
      type: 'key',
      id: `key-${index}`,
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
      id: `stat-${index}`,
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
      id: `graph-${index}`,
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
      id: `knob-${index}`,
      index,
      name: pos.layerName || `Knob ${index + 1}`,
      zIndex: pos.zIndex ?? index,
      hidden: !!pos.hidden,
      groupId: pos.groupId,
    });
  });

  // 플러그인 아이템
  pluginElements.forEach((el) => {
    items.push({
      type: 'plugin',
      id: el.fullId,
      name: el.definitionId || 'Plugin',
      zIndex: el.zIndex ?? 0,
      hidden: !!el.hidden,
      groupId: undefined,
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
