import { selectionElementId } from '@stores/grid/useGridSelectionStore';
import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import type { KeyPositions } from '@src/types/key/keys';
import type { StatItemPositions } from '@src/types/key/statItems';
import type { GraphItemPositions } from '@src/types/key/graphItems';
import type { KnobItemPositions } from '@src/types/key/knobs';
import type { LayerGroups, LayerGroupDef } from '@src/types/layerGroups';
import type {
  EditorElementGroupTargetV1,
  EditorTargetLayerGroupV1,
} from '@src/types/editor';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';

export const isPluginVisibleInMode = (
  element: Pick<PluginDisplayElementInternal, 'tabId'>,
  mode: string,
): boolean => !element.tabId || element.tabId === mode;

type Groupable = SelectedElement & {
  type: 'key' | 'stat' | 'graph' | 'knob';
  index: number;
};

function isGroupableElement(el: SelectedElement): el is Groupable {
  return (
    (el.type === 'key' ||
      el.type === 'stat' ||
      el.type === 'graph' ||
      el.type === 'knob') &&
    typeof el.index === 'number'
  );
}

function getElementGroupId(
  mode: string,
  element: Groupable,
  keyPositions: KeyPositions,
  statPositions: StatItemPositions,
  graphPositions: GraphItemPositions,
  knobPositions: KnobItemPositions,
): string | undefined {
  if (element.type === 'key') {
    return keyPositions[mode]?.[element.index]?.groupId;
  }
  if (element.type === 'stat') {
    return statPositions[mode]?.[element.index]?.groupId;
  }
  if (element.type === 'graph') {
    return graphPositions[mode]?.[element.index]?.groupId;
  }
  return knobPositions[mode]?.[element.index]?.groupId;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectModeGroupMemberCounts(
  mode: string,
  keyPositions: KeyPositions,
  statPositions: StatItemPositions,
  graphPositions: GraphItemPositions,
  knobPositions: KnobItemPositions,
): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (groupId?: string) => {
    if (!groupId) return;
    counts.set(groupId, (counts.get(groupId) || 0) + 1);
  };

  (keyPositions[mode] || []).forEach((pos) => add(pos?.groupId));
  (statPositions[mode] || []).forEach((pos) => add(pos?.groupId));
  (graphPositions[mode] || []).forEach((pos) => add(pos?.groupId));
  (knobPositions[mode] || []).forEach((pos) => add(pos?.groupId));

  return counts;
}

export function buildNextLayerGroupName(
  baseLabel: string,
  groups: LayerGroupDef[],
): string {
  const normalizedBase = (baseLabel || 'New Group').trim() || 'New Group';
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
  knobPositions: KnobItemPositions,
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
      knobPositions,
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
  knobPositions: KnobItemPositions;
  changed: boolean;
};

export function applyGroupIdToSelectedElements(params: {
  mode: string;
  selectedElements: SelectedElement[];
  keyPositions: KeyPositions;
  statPositions: StatItemPositions;
  graphPositions: GraphItemPositions;
  knobPositions: KnobItemPositions;
  targetGroupId: string | undefined;
}): ApplyGroupIdResult {
  const {
    mode,
    selectedElements,
    keyPositions,
    statPositions,
    graphPositions,
    knobPositions,
    targetGroupId,
  } = params;

  const nextKeyPositions: KeyPositions = { ...keyPositions };
  const nextStatPositions: StatItemPositions = { ...statPositions };
  const nextGraphPositions: GraphItemPositions = { ...graphPositions };
  const nextKnobPositions: KnobItemPositions = { ...knobPositions };
  const nextKeyMode = [...(keyPositions[mode] || [])];
  const nextStatMode = [...(statPositions[mode] || [])];
  const nextGraphMode = [...(graphPositions[mode] || [])];
  const nextKnobMode = [...(knobPositions[mode] || [])];

  let changed = false;
  let keyChanged = false;
  let statChanged = false;
  let graphChanged = false;
  let knobChanged = false;

  selectedElements.forEach((element) => {
    if (!isGroupableElement(element)) return;

    if (element.type === 'key') {
      const current = nextKeyMode[element.index];
      if (!current || current.groupId === targetGroupId) return;
      nextKeyMode[element.index] = { ...current, groupId: targetGroupId };
      keyChanged = true;
      changed = true;
      return;
    }

    if (element.type === 'stat') {
      const current = nextStatMode[element.index];
      if (!current || current.groupId === targetGroupId) return;
      nextStatMode[element.index] = { ...current, groupId: targetGroupId };
      statChanged = true;
      changed = true;
      return;
    }

    if (element.type === 'graph') {
      const current = nextGraphMode[element.index];
      if (!current || current.groupId === targetGroupId) return;
      nextGraphMode[element.index] = { ...current, groupId: targetGroupId };
      graphChanged = true;
      changed = true;
      return;
    }

    const current = nextKnobMode[element.index];
    if (!current || current.groupId === targetGroupId) return;
    nextKnobMode[element.index] = { ...current, groupId: targetGroupId };
    knobChanged = true;
    changed = true;
  });

  if (keyChanged) nextKeyPositions[mode] = nextKeyMode;
  if (statChanged) nextStatPositions[mode] = nextStatMode;
  if (graphChanged) nextGraphPositions[mode] = nextGraphMode;
  if (knobChanged) nextKnobPositions[mode] = nextKnobMode;

  return {
    keyPositions: changed ? nextKeyPositions : keyPositions,
    statPositions: changed ? nextStatPositions : statPositions,
    graphPositions: changed ? nextGraphPositions : graphPositions,
    knobPositions: changed ? nextKnobPositions : knobPositions,
    changed,
  };
}

export interface StableElementGroupProjection {
  keyPositions: KeyPositions;
  statPositions: StatItemPositions;
  graphPositions: GraphItemPositions;
  knobPositions: KnobItemPositions;
  layerGroups: LayerGroups;
  changed: boolean;
}

export function projectStableElementGroups(params: {
  mode: string;
  targets: readonly EditorElementGroupTargetV1[];
  targetGroup: EditorTargetLayerGroupV1 | null;
  keyPositions: KeyPositions;
  statPositions: StatItemPositions;
  graphPositions: GraphItemPositions;
  knobPositions: KnobItemPositions;
  layerGroups: LayerGroups;
}): StableElementGroupProjection | null {
  const {
    mode,
    targets,
    targetGroup,
    keyPositions,
    statPositions,
    graphPositions,
    knobPositions,
    layerGroups,
  } = params;
  const records = {
    key: keyPositions,
    stat: statPositions,
    graph: graphPositions,
    knob: knobPositions,
  } as const;
  const selectedElements: SelectedElement[] = [];
  for (const target of targets) {
    const positions = records[target.elementType][mode] ?? [];
    const index = positions.findIndex((position) => position?.id === target.id);
    if (index < 0) return null;
    selectedElements.push({
      type: target.elementType,
      id: target.id,
      index,
    });
  }

  const currentModeGroups = layerGroups[mode] ?? [];
  let nextLayerGroups = layerGroups;
  if (targetGroup?.kind === 'existing') {
    if (!currentModeGroups.some((group) => group.id === targetGroup.id)) {
      return null;
    }
  } else if (targetGroup?.kind === 'create') {
    const existing = currentModeGroups.find(
      (group) => group.id === targetGroup.id,
    );
    if (existing) return null;
    nextLayerGroups = {
      ...layerGroups,
      [mode]: [
        ...currentModeGroups,
        { id: targetGroup.id, name: targetGroup.name },
      ],
    };
  }

  const grouped = applyGroupIdToSelectedElements({
    mode,
    selectedElements,
    keyPositions,
    statPositions,
    graphPositions,
    knobPositions,
    targetGroupId: targetGroup?.id,
  });
  const targetTypes = new Set(targets.map((target) => target.elementType));
  const normalized = normalizeLayerGroupsForMode({
    mode,
    keyPositions: targetTypes.has('key') ? grouped.keyPositions : keyPositions,
    statPositions: targetTypes.has('stat')
      ? grouped.statPositions
      : statPositions,
    graphPositions: targetTypes.has('graph')
      ? grouped.graphPositions
      : graphPositions,
    knobPositions: targetTypes.has('knob')
      ? grouped.knobPositions
      : knobPositions,
    layerGroups: nextLayerGroups,
  });
  return {
    keyPositions: normalized.keyPositions,
    statPositions: normalized.statPositions,
    graphPositions: normalized.graphPositions,
    knobPositions: normalized.knobPositions,
    layerGroups: normalized.layerGroups,
    changed:
      grouped.changed ||
      normalized.positionsChanged ||
      normalized.groupsChanged ||
      nextLayerGroups !== layerGroups,
  };
}

export function projectLayerGroupRename(params: {
  mode: string;
  groupId: string;
  name: string;
  layerGroups: LayerGroups;
}): LayerGroups | null {
  const modeGroups = params.layerGroups[params.mode] ?? [];
  if (!modeGroups.some((group) => group.id === params.groupId)) return null;
  return {
    ...params.layerGroups,
    [params.mode]: modeGroups.map((group) =>
      group.id === params.groupId ? { ...group, name: params.name } : group,
    ),
  };
}

type NormalizeLayerGroupsResult = {
  keyPositions: KeyPositions;
  statPositions: StatItemPositions;
  graphPositions: GraphItemPositions;
  knobPositions: KnobItemPositions;
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
  knobPositions: KnobItemPositions;
  layerGroups: LayerGroups;
}): NormalizeLayerGroupsResult {
  const {
    mode,
    keyPositions,
    statPositions,
    graphPositions,
    knobPositions,
    layerGroups,
  } = params;

  const currentModeGroups = layerGroups[mode] || [];
  const nextKeyPositions: KeyPositions = { ...keyPositions };
  const nextStatPositions: StatItemPositions = { ...statPositions };
  const nextGraphPositions: GraphItemPositions = { ...graphPositions };
  const nextKnobPositions: KnobItemPositions = { ...knobPositions };
  const nextKeyMode = [...(keyPositions[mode] || [])];
  const nextStatMode = [...(statPositions[mode] || [])];
  const nextGraphMode = [...(graphPositions[mode] || [])];
  const nextKnobMode = [...(knobPositions[mode] || [])];

  const initialCounts = collectModeGroupMemberCounts(
    mode,
    keyPositions,
    statPositions,
    graphPositions,
    knobPositions,
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
    nextKnobMode.forEach((pos, index) => {
      if (!shouldClear(pos?.groupId)) return;
      nextKnobMode[index] = { ...pos, groupId: undefined };
      positionsChanged = true;
    });
  }

  if (positionsChanged) {
    nextKeyPositions[mode] = nextKeyMode;
    nextStatPositions[mode] = nextStatMode;
    nextGraphPositions[mode] = nextGraphMode;
    nextKnobPositions[mode] = nextKnobMode;
  }

  const finalCounts = collectModeGroupMemberCounts(
    mode,
    positionsChanged ? nextKeyPositions : keyPositions,
    positionsChanged ? nextStatPositions : statPositions,
    positionsChanged ? nextGraphPositions : graphPositions,
    positionsChanged ? nextKnobPositions : knobPositions,
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
    knobPositions: positionsChanged ? nextKnobPositions : knobPositions,
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
  type: 'key' | 'stat' | 'graph' | 'knob' | 'plugin';
  id: string;
  index?: number;
  zIndex: number;
  groupId?: string;
}

/** 5개 스토어에서 아이템을 수집하고 zIndex 내림차순 정렬 */
export function buildLayerItemsForMode(
  mode: string,
  keyPositions: KeyPositions,
  statPositions: StatItemPositions,
  graphPositions: GraphItemPositions,
  knobPositions: KnobItemPositions,
  pluginElements: PluginDisplayElementInternal[],
): LayerItemForOrder[] {
  const items: LayerItemForOrder[] = [];

  (keyPositions[mode] || []).forEach((pos, index) => {
    items.push({
      type: 'key',
      id: selectionElementId('key', pos, index),
      index,
      zIndex: pos.zIndex ?? index,
      groupId: pos.groupId,
    });
  });

  (statPositions[mode] || []).forEach((pos, index) => {
    items.push({
      type: 'stat',
      id: selectionElementId('stat', pos, index),
      index,
      zIndex: pos.zIndex ?? index,
      groupId: pos.groupId,
    });
  });

  (graphPositions[mode] || []).forEach((pos, index) => {
    items.push({
      type: 'graph',
      id: selectionElementId('graph', pos, index),
      index,
      zIndex: pos.zIndex ?? index,
      groupId: pos.groupId,
    });
  });

  (knobPositions[mode] || []).forEach((pos, index) => {
    items.push({
      type: 'knob',
      id: selectionElementId('knob', pos, index),
      index,
      zIndex: pos.zIndex ?? index,
      groupId: pos.groupId,
    });
  });

  pluginElements
    .filter((el) => isPluginVisibleInMode(el, mode))
    .forEach((el) => {
      items.push({
        type: 'plugin',
        id: el.fullId,
        zIndex: el.zIndex ?? 0,
        groupId: el.groupId,
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
  knobPositions: KnobItemPositions;
  pluginUpdates: Array<{ fullId: string; zIndex: number }>;
}

/** 정렬된 아이템 배열에 maxZIndex - idx 패턴으로 zIndex 일괄 재부여 */
export function applyZIndexToLayerOrder(
  orderedItems: LayerItemForOrder[],
  mode: string,
  keyPositions: KeyPositions,
  statPositions: StatItemPositions,
  graphPositions: GraphItemPositions,
  knobPositions: KnobItemPositions,
): ZIndexPatchResult {
  const maxZIndex = orderedItems.length - 1;
  const keyMode = [...(keyPositions[mode] || [])];
  const statMode = [...(statPositions[mode] || [])];
  const graphMode = [...(graphPositions[mode] || [])];
  const knobMode = [...(knobPositions[mode] || [])];
  const pluginUpdates: Array<{ fullId: string; zIndex: number }> = [];

  orderedItems.forEach((item, idx) => {
    const z = maxZIndex - idx;
    if (
      item.type === 'key' &&
      item.index !== undefined &&
      keyMode[item.index]
    ) {
      keyMode[item.index] = { ...keyMode[item.index], zIndex: z };
    } else if (
      item.type === 'stat' &&
      item.index !== undefined &&
      statMode[item.index]
    ) {
      statMode[item.index] = { ...statMode[item.index], zIndex: z };
    } else if (
      item.type === 'graph' &&
      item.index !== undefined &&
      graphMode[item.index]
    ) {
      graphMode[item.index] = { ...graphMode[item.index], zIndex: z };
    } else if (
      item.type === 'knob' &&
      item.index !== undefined &&
      knobMode[item.index]
    ) {
      knobMode[item.index] = { ...knobMode[item.index], zIndex: z };
    } else if (item.type === 'plugin') {
      pluginUpdates.push({ fullId: item.id, zIndex: z });
    }
  });

  return {
    keyPositions: { ...keyPositions, [mode]: keyMode },
    statPositions: { ...statPositions, [mode]: statMode },
    graphPositions: { ...graphPositions, [mode]: graphMode },
    knobPositions: { ...knobPositions, [mode]: knobMode },
    pluginUpdates,
  };
}
