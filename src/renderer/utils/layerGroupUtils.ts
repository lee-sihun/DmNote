import type { SelectedElement } from "@stores/useGridSelectionStore";
import type { KeyPositions } from "@src/types/keys";
import type { StatItemPositions } from "@src/types/statItems";
import type { GraphItemPositions } from "@src/types/graphItems";
import type { LayerGroups, LayerGroupDef } from "@src/types/layerGroups";
import type { PluginDisplayElementInternal } from "@src/types/api";

type Groupable = SelectedElement & {
  type: "key" | "stat" | "graph";
  index: number;
};

function isGroupableElement(el: SelectedElement): el is Groupable {
  return (
    (el.type === "key" || el.type === "stat" || el.type === "graph") &&
    typeof el.index === "number"
  );
}

function getElementGroupId(
  mode: string,
  element: Groupable,
  keyPositions: KeyPositions,
  statPositions: StatItemPositions,
  graphPositions: GraphItemPositions,
): string | undefined {
  if (element.type === "key") {
    return keyPositions[mode]?.[element.index]?.groupId;
  }
  if (element.type === "stat") {
    return statPositions[mode]?.[element.index]?.groupId;
  }
  return graphPositions[mode]?.[element.index]?.groupId;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectModeGroupMemberCounts(
  mode: string,
  keyPositions: KeyPositions,
  statPositions: StatItemPositions,
  graphPositions: GraphItemPositions,
): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (groupId?: string) => {
    if (!groupId) return;
    counts.set(groupId, (counts.get(groupId) || 0) + 1);
  };

  (keyPositions[mode] || []).forEach((pos) => add(pos?.groupId));
  (statPositions[mode] || []).forEach((pos) => add(pos?.groupId));
  (graphPositions[mode] || []).forEach((pos) => add(pos?.groupId));

  return counts;
}

export function buildNextLayerGroupName(
  baseLabel: string,
  groups: LayerGroupDef[],
): string {
  const normalizedBase = (baseLabel || "New Group").trim() || "New Group";
  const pattern = new RegExp(`^${escapeRegExp(normalizedBase)}\\s+(\\d+)$`);
  const usedNumbers = new Set<number>();

  groups.forEach((group) => {
    const match = group.name.match(pattern);
    if (!match) return;
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0) {
      usedNumbers.add(value);
    }
  });

  let next = 1;
  while (usedNumbers.has(next)) {
    next += 1;
  }

  return `${normalizedBase} ${next}`;
}

export function resolveSingleGroupIdFromSelection(
  mode: string,
  selectedElements: SelectedElement[],
  keyPositions: KeyPositions,
  statPositions: StatItemPositions,
  graphPositions: GraphItemPositions,
): string | undefined {
  const groupIds = new Set<string>();

  selectedElements.forEach((element) => {
    if (!isGroupableElement(element)) return;
    const groupId = getElementGroupId(
      mode,
      element,
      keyPositions,
      statPositions,
      graphPositions,
    );
    if (groupId) {
      groupIds.add(groupId);
    }
  });

  if (groupIds.size !== 1) return undefined;
  return Array.from(groupIds)[0];
}

type ApplyGroupIdResult = {
  keyPositions: KeyPositions;
  statPositions: StatItemPositions;
  graphPositions: GraphItemPositions;
  changed: boolean;
};

export function applyGroupIdToSelectedElements(params: {
  mode: string;
  selectedElements: SelectedElement[];
  keyPositions: KeyPositions;
  statPositions: StatItemPositions;
  graphPositions: GraphItemPositions;
  targetGroupId: string | undefined;
}): ApplyGroupIdResult {
  const {
    mode,
    selectedElements,
    keyPositions,
    statPositions,
    graphPositions,
    targetGroupId,
  } = params;

  const nextKeyPositions: KeyPositions = { ...keyPositions };
  const nextStatPositions: StatItemPositions = { ...statPositions };
  const nextGraphPositions: GraphItemPositions = { ...graphPositions };
  const nextKeyMode = [...(keyPositions[mode] || [])];
  const nextStatMode = [...(statPositions[mode] || [])];
  const nextGraphMode = [...(graphPositions[mode] || [])];

  let changed = false;

  selectedElements.forEach((element) => {
    if (!isGroupableElement(element)) return;

    if (element.type === "key") {
      const current = nextKeyMode[element.index];
      if (!current || current.groupId === targetGroupId) return;
      nextKeyMode[element.index] = { ...current, groupId: targetGroupId };
      changed = true;
      return;
    }

    if (element.type === "stat") {
      const current = nextStatMode[element.index];
      if (!current || current.groupId === targetGroupId) return;
      nextStatMode[element.index] = { ...current, groupId: targetGroupId };
      changed = true;
      return;
    }

    const current = nextGraphMode[element.index];
    if (!current || current.groupId === targetGroupId) return;
    nextGraphMode[element.index] = { ...current, groupId: targetGroupId };
    changed = true;
  });

  if (changed) {
    nextKeyPositions[mode] = nextKeyMode;
    nextStatPositions[mode] = nextStatMode;
    nextGraphPositions[mode] = nextGraphMode;
  }

  return {
    keyPositions: changed ? nextKeyPositions : keyPositions,
    statPositions: changed ? nextStatPositions : statPositions,
    graphPositions: changed ? nextGraphPositions : graphPositions,
    changed,
  };
}

type NormalizeLayerGroupsResult = {
  keyPositions: KeyPositions;
  statPositions: StatItemPositions;
  graphPositions: GraphItemPositions;
  layerGroups: LayerGroups;
  positionsChanged: boolean;
  groupsChanged: boolean;
  removedGroupIds: string[];
};

export function normalizeLayerGroupsForMode(params: {
  mode: string;
  keyPositions: KeyPositions;
  statPositions: StatItemPositions;
  graphPositions: GraphItemPositions;
  layerGroups: LayerGroups;
}): NormalizeLayerGroupsResult {
  const { mode, keyPositions, statPositions, graphPositions, layerGroups } = params;

  const currentModeGroups = layerGroups[mode] || [];
  const nextKeyPositions: KeyPositions = { ...keyPositions };
  const nextStatPositions: StatItemPositions = { ...statPositions };
  const nextGraphPositions: GraphItemPositions = { ...graphPositions };
  const nextKeyMode = [...(keyPositions[mode] || [])];
  const nextStatMode = [...(statPositions[mode] || [])];
  const nextGraphMode = [...(graphPositions[mode] || [])];

  const initialCounts = collectModeGroupMemberCounts(
    mode,
    keyPositions,
    statPositions,
    graphPositions,
  );
  const groupsToDissolve = new Set<string>();

  initialCounts.forEach((count, groupId) => {
    if (count === 0) {
      groupsToDissolve.add(groupId);
    }
  });
  currentModeGroups.forEach((group) => {
    const count = initialCounts.get(group.id) || 0;
    if (count === 0) {
      groupsToDissolve.add(group.id);
    }
  });

  let positionsChanged = false;
  if (groupsToDissolve.size > 0) {
    const shouldClear = (groupId?: string) =>
      !!groupId && groupsToDissolve.has(groupId);

    nextKeyMode.forEach((pos, index) => {
      if (!shouldClear(pos?.groupId)) return;
      nextKeyMode[index] = { ...pos, groupId: undefined };
      positionsChanged = true;
    });
    nextStatMode.forEach((pos, index) => {
      if (!shouldClear(pos?.groupId)) return;
      nextStatMode[index] = { ...pos, groupId: undefined };
      positionsChanged = true;
    });
    nextGraphMode.forEach((pos, index) => {
      if (!shouldClear(pos?.groupId)) return;
      nextGraphMode[index] = { ...pos, groupId: undefined };
      positionsChanged = true;
    });
  }

  if (positionsChanged) {
    nextKeyPositions[mode] = nextKeyMode;
    nextStatPositions[mode] = nextStatMode;
    nextGraphPositions[mode] = nextGraphMode;
  }

  const finalCounts = collectModeGroupMemberCounts(
    mode,
    positionsChanged ? nextKeyPositions : keyPositions,
    positionsChanged ? nextStatPositions : statPositions,
    positionsChanged ? nextGraphPositions : graphPositions,
  );
  const nextModeGroups = currentModeGroups.filter(
    (group) => (finalCounts.get(group.id) || 0) >= 1,
  );
  const removedGroupIds = currentModeGroups
    .filter((group) => !nextModeGroups.some((next) => next.id === group.id))
    .map((group) => group.id);

  const groupsChanged = removedGroupIds.length > 0;
  const nextLayerGroups = groupsChanged
    ? {
        ...layerGroups,
        [mode]: nextModeGroups,
      }
    : layerGroups;

  return {
    keyPositions: positionsChanged ? nextKeyPositions : keyPositions,
    statPositions: positionsChanged ? nextStatPositions : statPositions,
    graphPositions: positionsChanged ? nextGraphPositions : graphPositions,
    layerGroups: nextLayerGroups,
    positionsChanged,
    groupsChanged,
    removedGroupIds,
  };
}

// ============================================================================
// 레이어 순서 유틸 (paste / reorder 공용)
// ============================================================================

export interface LayerItemForOrder {
  type: "key" | "stat" | "graph" | "plugin";
  id: string;
  index?: number;
  zIndex: number;
  groupId?: string;
}

/** 4개 스토어에서 아이템을 수집하고 zIndex 내림차순 정렬 */
export function buildLayerItemsForMode(
  mode: string,
  keyPositions: KeyPositions,
  statPositions: StatItemPositions,
  graphPositions: GraphItemPositions,
  pluginElements: PluginDisplayElementInternal[],
): LayerItemForOrder[] {
  const items: LayerItemForOrder[] = [];

  (keyPositions[mode] || []).forEach((pos, index) => {
    items.push({
      type: "key",
      id: `key-${index}`,
      index,
      zIndex: pos.zIndex ?? index,
      groupId: pos.groupId,
    });
  });

  (statPositions[mode] || []).forEach((pos, index) => {
    items.push({
      type: "stat",
      id: `stat-${index}`,
      index,
      zIndex: pos.zIndex ?? index,
      groupId: (pos as any).groupId,
    });
  });

  (graphPositions[mode] || []).forEach((pos, index) => {
    items.push({
      type: "graph",
      id: `graph-${index}`,
      index,
      zIndex: pos.zIndex ?? index,
      groupId: (pos as any).groupId,
    });
  });

  pluginElements
    .filter((el) => (el as any).tabId === mode)
    .forEach((el) => {
      items.push({
        type: "plugin",
        id: el.fullId,
        zIndex: el.zIndex ?? 0,
        groupId: (el as any).groupId,
      });
    });

  items.sort((a, b) => b.zIndex - a.zIndex);
  return items;
}

/** 선택 상태 기반으로 paste 앵커 위치 결정 (선택된 레이어 바로 위에 삽입) */
export function findPasteAnchorIndex(
  orderedItems: LayerItemForOrder[],
  selectedElements: SelectedElement[],
  selectedGroupIds: string[],
): number {
  if (orderedItems.length === 0) return 0;

  const idToIndex = new Map<string, number>();
  const groupTopIndex = new Map<string, number>();

  orderedItems.forEach((item, idx) => {
    idToIndex.set(item.id, idx);
    // 그룹의 첫 자식 = zIndex 내림차순에서 가장 위
    if (item.groupId && !groupTopIndex.has(item.groupId)) {
      groupTopIndex.set(item.groupId, idx);
    }
  });

  let anchor = Number.POSITIVE_INFINITY;

  for (const el of selectedElements) {
    const idx = idToIndex.get(el.id);
    if (idx !== undefined && idx < anchor) anchor = idx;
  }

  for (const gid of selectedGroupIds) {
    const idx = groupTopIndex.get(gid);
    if (idx !== undefined && idx < anchor) anchor = idx;
  }

  return Number.isFinite(anchor) ? anchor : 0;
}

export interface ZIndexPatchResult {
  keyPositions: KeyPositions;
  statPositions: StatItemPositions;
  graphPositions: GraphItemPositions;
  pluginUpdates: Array<{ fullId: string; zIndex: number }>;
}

/** 정렬된 아이템 배열에 maxZIndex - idx 패턴으로 zIndex 일괄 재부여 */
export function applyZIndexToLayerOrder(
  orderedItems: LayerItemForOrder[],
  mode: string,
  keyPositions: KeyPositions,
  statPositions: StatItemPositions,
  graphPositions: GraphItemPositions,
): ZIndexPatchResult {
  const maxZIndex = orderedItems.length - 1;
  const keyMode = [...(keyPositions[mode] || [])];
  const statMode = [...(statPositions[mode] || [])];
  const graphMode = [...(graphPositions[mode] || [])];
  const pluginUpdates: Array<{ fullId: string; zIndex: number }> = [];

  orderedItems.forEach((item, idx) => {
    const z = maxZIndex - idx;
    if (item.type === "key" && item.index !== undefined && keyMode[item.index]) {
      keyMode[item.index] = { ...keyMode[item.index], zIndex: z };
    } else if (item.type === "stat" && item.index !== undefined && statMode[item.index]) {
      statMode[item.index] = { ...statMode[item.index], zIndex: z };
    } else if (item.type === "graph" && item.index !== undefined && graphMode[item.index]) {
      graphMode[item.index] = { ...graphMode[item.index], zIndex: z };
    } else if (item.type === "plugin") {
      pluginUpdates.push({ fullId: item.id, zIndex: z });
    }
  });

  return {
    keyPositions: { ...keyPositions, [mode]: keyMode },
    statPositions: { ...statPositions, [mode]: statMode },
    graphPositions: { ...graphPositions, [mode]: graphMode },
    pluginUpdates,
  };
}
