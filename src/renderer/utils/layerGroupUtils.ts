import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import type { LayerGroups, LayerGroupDef } from '@src/types/layerGroups';
import type {
  EditorElementGroupTargetV1,
  EditorTargetLayerGroupV1,
  CanonicalEditorDocumentV1,
} from '@src/types/editor';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';
import { normalizePluginInstanceTabId } from '@plugins/runtime/displayElement/instanceLifecycle';
import { toSpriteWireShape } from '@utils/sprite/spriteWireShape';

export const isPluginVisibleInMode = (
  element: Pick<PluginDisplayElementInternal, 'tabId'>,
  mode: string,
): boolean => !element.tabId || element.tabId === mode;

/** 그룹 멤버 집계용 플러그인 요소 최소 형태 (내부 요소·패널 뷰 공용) */
export type PluginGroupMemberLike = Pick<
  PluginDisplayElementInternal,
  'tabId' | 'groupId'
>;

// 플러그인 그룹 멤버십의 모드 판정 - 저장 규칙(tab_id normalize)과 동일.
// Rust remove_empty_layer_groups의 판정과 반드시 일치해야 커밋마다
// 가짜 diff가 생기지 않는다 (드리프트 금지)
export const isPluginGroupMemberInMode = (
  element: Pick<PluginDisplayElementInternal, 'tabId'>,
  mode: string,
): boolean => normalizePluginInstanceTabId(element.tabId) === mode;

type Groupable = SelectedElement & {
  type: 'key' | 'stat' | 'graph' | 'knob' | 'sprite';
};

function isGroupableElement(el: SelectedElement): el is Groupable {
  return (
    el.type === 'key' ||
    el.type === 'stat' ||
    el.type === 'graph' ||
    el.type === 'knob' ||
    el.type === 'sprite'
  );
}

function getElementGroupId(
  mode: string,
  element: Groupable,
  keyPositions: CanonicalEditorDocumentV1['keyPositions'],
  statPositions: CanonicalEditorDocumentV1['statPositions'],
  graphPositions: CanonicalEditorDocumentV1['graphPositions'],
  knobPositions: CanonicalEditorDocumentV1['knobPositions'],
  spritePositions: CanonicalEditorDocumentV1['spritePositions'],
): string | undefined {
  if (element.type === 'key') {
    return keyPositions[mode]?.find(({ id }) => id === element.id)?.groupId;
  }
  if (element.type === 'stat') {
    return statPositions[mode]?.find(({ id }) => id === element.id)?.groupId;
  }
  if (element.type === 'graph') {
    return graphPositions[mode]?.find(({ id }) => id === element.id)?.groupId;
  }
  if (element.type === 'knob') {
    return knobPositions[mode]?.find(({ id }) => id === element.id)?.groupId;
  }
  return (
    spritePositions[mode]?.find(({ id }) => id === element.id)?.groupId ??
    undefined
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectModeGroupMemberCounts(
  mode: string,
  keyPositions: CanonicalEditorDocumentV1['keyPositions'],
  statPositions: CanonicalEditorDocumentV1['statPositions'],
  graphPositions: CanonicalEditorDocumentV1['graphPositions'],
  knobPositions: CanonicalEditorDocumentV1['knobPositions'],
  spritePositions: CanonicalEditorDocumentV1['spritePositions'],
  pluginElements: readonly PluginGroupMemberLike[],
): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (groupId?: string | null) => {
    if (!groupId) return;
    counts.set(groupId, (counts.get(groupId) || 0) + 1);
  };

  (keyPositions[mode] || []).forEach((pos) => add(pos?.groupId));
  (statPositions[mode] || []).forEach((pos) => add(pos?.groupId));
  (graphPositions[mode] || []).forEach((pos) => add(pos?.groupId));
  (knobPositions[mode] || []).forEach((pos) => add(pos?.groupId));
  (spritePositions[mode] || []).forEach((pos) => add(pos?.groupId));
  // 플러그인 멤버도 그룹 생존에 기여 - 모드 판정은 저장 규칙과 동일
  pluginElements.forEach((element) => {
    if (isPluginGroupMemberInMode(element, mode)) add(element.groupId);
  });

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
  keyPositions: CanonicalEditorDocumentV1['keyPositions'],
  statPositions: CanonicalEditorDocumentV1['statPositions'],
  graphPositions: CanonicalEditorDocumentV1['graphPositions'],
  knobPositions: CanonicalEditorDocumentV1['knobPositions'],
  spritePositions: CanonicalEditorDocumentV1['spritePositions'],
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
      spritePositions,
    );
    if (groupId) {
      groupIds.add(groupId);
    }
  });

  if (groupIds.size !== 1) return undefined;
  return Array.from(groupIds)[0];
}

type ApplyGroupIdResult = {
  keyPositions: CanonicalEditorDocumentV1['keyPositions'];
  statPositions: CanonicalEditorDocumentV1['statPositions'];
  graphPositions: CanonicalEditorDocumentV1['graphPositions'];
  knobPositions: CanonicalEditorDocumentV1['knobPositions'];
  spritePositions: CanonicalEditorDocumentV1['spritePositions'];
  changed: boolean;
};

export function applyGroupIdToSelectedElements(params: {
  mode: string;
  selectedElements: SelectedElement[];
  keyPositions: CanonicalEditorDocumentV1['keyPositions'];
  statPositions: CanonicalEditorDocumentV1['statPositions'];
  graphPositions: CanonicalEditorDocumentV1['graphPositions'];
  knobPositions: CanonicalEditorDocumentV1['knobPositions'];
  spritePositions: CanonicalEditorDocumentV1['spritePositions'];
  targetGroupId: string | undefined;
}): ApplyGroupIdResult {
  const {
    mode,
    selectedElements,
    keyPositions,
    statPositions,
    graphPositions,
    knobPositions,
    spritePositions,
    targetGroupId,
  } = params;

  const nextKeyPositions = { ...keyPositions };
  const nextStatPositions = { ...statPositions };
  const nextGraphPositions = { ...graphPositions };
  const nextKnobPositions = { ...knobPositions };
  const nextSpritePositions = { ...spritePositions };
  const nextKeyMode = [...(keyPositions[mode] || [])];
  const nextStatMode = [...(statPositions[mode] || [])];
  const nextGraphMode = [...(graphPositions[mode] || [])];
  const nextKnobMode = [...(knobPositions[mode] || [])];
  const nextSpriteMode = [...(spritePositions[mode] || [])];

  let changed = false;
  let keyChanged = false;
  let statChanged = false;
  let graphChanged = false;
  let knobChanged = false;
  let spriteChanged = false;

  selectedElements.forEach((element) => {
    if (!isGroupableElement(element)) return;

    if (element.type === 'key') {
      const index = nextKeyMode.findIndex(({ id }) => id === element.id);
      const current = nextKeyMode[index];
      if (!current || current.groupId === targetGroupId) return;
      nextKeyMode[index] = { ...current, groupId: targetGroupId };
      keyChanged = true;
      changed = true;
      return;
    }

    if (element.type === 'stat') {
      const index = nextStatMode.findIndex(({ id }) => id === element.id);
      const current = nextStatMode[index];
      if (!current || current.groupId === targetGroupId) return;
      nextStatMode[index] = { ...current, groupId: targetGroupId };
      statChanged = true;
      changed = true;
      return;
    }

    if (element.type === 'graph') {
      const index = nextGraphMode.findIndex(({ id }) => id === element.id);
      const current = nextGraphMode[index];
      if (!current || current.groupId === targetGroupId) return;
      nextGraphMode[index] = { ...current, groupId: targetGroupId };
      graphChanged = true;
      changed = true;
      return;
    }

    if (element.type === 'knob') {
      const index = nextKnobMode.findIndex(({ id }) => id === element.id);
      const current = nextKnobMode[index];
      if (!current || current.groupId === targetGroupId) return;
      nextKnobMode[index] = { ...current, groupId: targetGroupId };
      knobChanged = true;
      changed = true;
      return;
    }

    const index = nextSpriteMode.findIndex(({ id }) => id === element.id);
    const current = nextSpriteMode[index];
    // 명시 null 이력까지 undefined로 접어 동치 비교
    if (!current || (current.groupId ?? undefined) === targetGroupId) return;
    // wire 정규화: 해제(undefined)는 groupId 키 부재로 맞춰 ack와 일치
    nextSpriteMode[index] = toSpriteWireShape({
      ...current,
      groupId: targetGroupId,
    });
    spriteChanged = true;
    changed = true;
  });

  if (keyChanged) nextKeyPositions[mode] = nextKeyMode;
  if (statChanged) nextStatPositions[mode] = nextStatMode;
  if (graphChanged) nextGraphPositions[mode] = nextGraphMode;
  if (knobChanged) nextKnobPositions[mode] = nextKnobMode;
  if (spriteChanged) nextSpritePositions[mode] = nextSpriteMode;

  return {
    keyPositions: changed ? nextKeyPositions : keyPositions,
    statPositions: changed ? nextStatPositions : statPositions,
    graphPositions: changed ? nextGraphPositions : graphPositions,
    knobPositions: changed ? nextKnobPositions : knobPositions,
    spritePositions: changed ? nextSpritePositions : spritePositions,
    changed,
  };
}

export interface StableElementGroupProjection {
  keyPositions: CanonicalEditorDocumentV1['keyPositions'];
  statPositions: CanonicalEditorDocumentV1['statPositions'];
  graphPositions: CanonicalEditorDocumentV1['graphPositions'];
  knobPositions: CanonicalEditorDocumentV1['knobPositions'];
  spritePositions: CanonicalEditorDocumentV1['spritePositions'];
  layerGroups: LayerGroups;
  changed: boolean;
}

export function projectStableElementGroups(params: {
  mode: string;
  targets: readonly EditorElementGroupTargetV1[];
  targetGroup: EditorTargetLayerGroupV1 | null;
  keyPositions: CanonicalEditorDocumentV1['keyPositions'];
  statPositions: CanonicalEditorDocumentV1['statPositions'];
  graphPositions: CanonicalEditorDocumentV1['graphPositions'];
  knobPositions: CanonicalEditorDocumentV1['knobPositions'];
  spritePositions: CanonicalEditorDocumentV1['spritePositions'];
  layerGroups: LayerGroups;
  // normalize의 플러그인 멤버 집계 - 혼합 그룹화는 최종 소속 상태를 전달
  pluginElements: readonly PluginGroupMemberLike[];
}): StableElementGroupProjection | null {
  const {
    mode,
    targets,
    targetGroup,
    keyPositions,
    statPositions,
    graphPositions,
    knobPositions,
    spritePositions,
    layerGroups,
    pluginElements,
  } = params;
  const records = {
    key: keyPositions,
    stat: statPositions,
    graph: graphPositions,
    knob: knobPositions,
    sprite: spritePositions,
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
    spritePositions,
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
    spritePositions: targetTypes.has('sprite')
      ? grouped.spritePositions
      : spritePositions,
    layerGroups: nextLayerGroups,
    pluginElements,
  });
  return {
    keyPositions: normalized.keyPositions,
    statPositions: normalized.statPositions,
    graphPositions: normalized.graphPositions,
    knobPositions: normalized.knobPositions,
    spritePositions: normalized.spritePositions,
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
  keyPositions: CanonicalEditorDocumentV1['keyPositions'];
  statPositions: CanonicalEditorDocumentV1['statPositions'];
  graphPositions: CanonicalEditorDocumentV1['graphPositions'];
  knobPositions: CanonicalEditorDocumentV1['knobPositions'];
  spritePositions: CanonicalEditorDocumentV1['spritePositions'];
  layerGroups: LayerGroups;
  positionsChanged: boolean;
  groupsChanged: boolean;
  removedGroupIds: string[];
};

export function normalizeLayerGroupsForMode(params: {
  mode: string;
  keyPositions: CanonicalEditorDocumentV1['keyPositions'];
  statPositions: CanonicalEditorDocumentV1['statPositions'];
  graphPositions: CanonicalEditorDocumentV1['graphPositions'];
  knobPositions: CanonicalEditorDocumentV1['knobPositions'];
  spritePositions: CanonicalEditorDocumentV1['spritePositions'];
  layerGroups: LayerGroups;
  // 플러그인 멤버 집계 - Rust remove_empty_layer_groups와 동일 규칙 필수
  pluginElements: readonly PluginGroupMemberLike[];
}): NormalizeLayerGroupsResult {
  const {
    mode,
    keyPositions,
    statPositions,
    graphPositions,
    knobPositions,
    spritePositions,
    layerGroups,
    pluginElements,
  } = params;

  const currentModeGroups = layerGroups[mode] || [];
  const nextKeyPositions = { ...keyPositions };
  const nextStatPositions = { ...statPositions };
  const nextGraphPositions = { ...graphPositions };
  const nextKnobPositions = { ...knobPositions };
  const nextSpritePositions = { ...spritePositions };
  const nextKeyMode = [...(keyPositions[mode] || [])];
  const nextStatMode = [...(statPositions[mode] || [])];
  const nextGraphMode = [...(graphPositions[mode] || [])];
  const nextKnobMode = [...(knobPositions[mode] || [])];
  const nextSpriteMode = [...(spritePositions[mode] || [])];

  const initialCounts = collectModeGroupMemberCounts(
    mode,
    keyPositions,
    statPositions,
    graphPositions,
    knobPositions,
    spritePositions,
    pluginElements,
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
    const shouldClear = (groupId?: string | null) =>
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
    nextSpriteMode.forEach((pos, index) => {
      if (!shouldClear(pos?.groupId)) return;
      // wire 정규화: 해제는 groupId 키 부재로 맞춰 ack와 일치
      nextSpriteMode[index] = toSpriteWireShape({ ...pos, groupId: undefined });
      positionsChanged = true;
    });
  }

  if (positionsChanged) {
    nextKeyPositions[mode] = nextKeyMode;
    nextStatPositions[mode] = nextStatMode;
    nextGraphPositions[mode] = nextGraphMode;
    nextKnobPositions[mode] = nextKnobMode;
    nextSpritePositions[mode] = nextSpriteMode;
  }

  const finalCounts = collectModeGroupMemberCounts(
    mode,
    positionsChanged ? nextKeyPositions : keyPositions,
    positionsChanged ? nextStatPositions : statPositions,
    positionsChanged ? nextGraphPositions : graphPositions,
    positionsChanged ? nextKnobPositions : knobPositions,
    positionsChanged ? nextSpritePositions : spritePositions,
    pluginElements,
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
    spritePositions: positionsChanged ? nextSpritePositions : spritePositions,
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
  type: 'key' | 'stat' | 'graph' | 'knob' | 'sprite' | 'plugin';
  id: string;
  index?: number;
  zIndex: number;
  groupId?: string;
}

/** 6개 스토어에서 아이템을 수집하고 zIndex 내림차순 정렬 */
export function buildLayerItemsForMode(
  mode: string,
  keyPositions: CanonicalEditorDocumentV1['keyPositions'],
  statPositions: CanonicalEditorDocumentV1['statPositions'],
  graphPositions: CanonicalEditorDocumentV1['graphPositions'],
  knobPositions: CanonicalEditorDocumentV1['knobPositions'],
  spritePositions: CanonicalEditorDocumentV1['spritePositions'],
  pluginElements: PluginDisplayElementInternal[],
): LayerItemForOrder[] {
  const items: LayerItemForOrder[] = [];

  (keyPositions[mode] || []).forEach((pos, index) => {
    items.push({
      type: 'key',
      id: pos.id,
      index,
      zIndex: pos.zIndex ?? index,
      groupId: pos.groupId,
    });
  });

  (statPositions[mode] || []).forEach((pos, index) => {
    items.push({
      type: 'stat',
      id: pos.id,
      index,
      zIndex: pos.zIndex ?? index,
      groupId: pos.groupId,
    });
  });

  (graphPositions[mode] || []).forEach((pos, index) => {
    items.push({
      type: 'graph',
      id: pos.id,
      index,
      zIndex: pos.zIndex ?? index,
      groupId: pos.groupId,
    });
  });

  (knobPositions[mode] || []).forEach((pos, index) => {
    items.push({
      type: 'knob',
      id: pos.id,
      index,
      zIndex: pos.zIndex ?? index,
      groupId: pos.groupId,
    });
  });

  (spritePositions[mode] || []).forEach((pos, index) => {
    items.push({
      type: 'sprite',
      id: pos.id,
      index,
      zIndex: pos.zIndex ?? index,
      groupId: pos.groupId ?? undefined,
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
  keyPositions: CanonicalEditorDocumentV1['keyPositions'];
  statPositions: CanonicalEditorDocumentV1['statPositions'];
  graphPositions: CanonicalEditorDocumentV1['graphPositions'];
  knobPositions: CanonicalEditorDocumentV1['knobPositions'];
  spritePositions: CanonicalEditorDocumentV1['spritePositions'];
  pluginUpdates: Array<{ fullId: string; zIndex: number }>;
}

/** 정렬된 아이템 배열에 maxZIndex - idx 패턴으로 zIndex 일괄 재부여 */
export function applyZIndexToLayerOrder(
  orderedItems: LayerItemForOrder[],
  mode: string,
  keyPositions: CanonicalEditorDocumentV1['keyPositions'],
  statPositions: CanonicalEditorDocumentV1['statPositions'],
  graphPositions: CanonicalEditorDocumentV1['graphPositions'],
  knobPositions: CanonicalEditorDocumentV1['knobPositions'],
  spritePositions: CanonicalEditorDocumentV1['spritePositions'],
): ZIndexPatchResult {
  const maxZIndex = orderedItems.length - 1;
  const keyMode = [...(keyPositions[mode] || [])];
  const statMode = [...(statPositions[mode] || [])];
  const graphMode = [...(graphPositions[mode] || [])];
  const knobMode = [...(knobPositions[mode] || [])];
  const spriteMode = [...(spritePositions[mode] || [])];
  const pluginUpdates: Array<{ fullId: string; zIndex: number }> = [];

  orderedItems.forEach((item, idx) => {
    const z = maxZIndex - idx;
    if (item.type === 'key') {
      const index = keyMode.findIndex((position) => position.id === item.id);
      if (index !== -1) keyMode[index] = { ...keyMode[index], zIndex: z };
    } else if (item.type === 'stat') {
      const index = statMode.findIndex((position) => position.id === item.id);
      if (index !== -1) statMode[index] = { ...statMode[index], zIndex: z };
    } else if (item.type === 'graph') {
      const index = graphMode.findIndex((position) => position.id === item.id);
      if (index !== -1) graphMode[index] = { ...graphMode[index], zIndex: z };
    } else if (item.type === 'knob') {
      const index = knobMode.findIndex((position) => position.id === item.id);
      if (index !== -1) knobMode[index] = { ...knobMode[index], zIndex: z };
    } else if (item.type === 'sprite') {
      const index = spriteMode.findIndex((position) => position.id === item.id);
      if (index !== -1) spriteMode[index] = { ...spriteMode[index], zIndex: z };
    } else if (item.type === 'plugin') {
      pluginUpdates.push({ fullId: item.id, zIndex: z });
    }
  });

  return {
    keyPositions: { ...keyPositions, [mode]: keyMode },
    statPositions: { ...statPositions, [mode]: statMode },
    graphPositions: { ...graphPositions, [mode]: graphMode },
    knobPositions: { ...knobPositions, [mode]: knobMode },
    spritePositions: { ...spritePositions, [mode]: spriteMode },
    pluginUpdates,
  };
}
