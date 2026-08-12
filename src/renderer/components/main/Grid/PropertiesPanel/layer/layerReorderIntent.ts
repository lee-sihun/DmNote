import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import {
  applyPropertyIntentsEagerly,
  combineReceipts,
  ElementIntentAbort,
  type ElementIntentReceipt,
} from '@src/renderer/editor/runtime/elementIntent';
import { runMixedGestureElementIntent } from '@src/renderer/editor/runtime/mixedElementIntent';
import {
  beginMixedGestureTransaction,
  cancelUncommittedMixedGestureTransaction,
} from '@plugins/runtime/displayElement/gestureTransaction';
import { rotatePluginInstancesEditSession } from '@plugins/runtime/displayElement/instancesCommitQueue';
import { getPluginAuthorityGeneration } from '@plugins/rpc/pluginRpcClient';
import {
  buildLayerItemsForMode,
  isPluginVisibleInMode,
} from '@utils/layerGroupUtils';
import { buildDisplayItems } from './layerPanelModel';

import type {
  EditorDocumentV1,
  EditorReorderElementsOpV1,
} from '@src/types/editor';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';
import type { DisplayItem, LayerItem } from '../types';

type NativeType = 'key' | 'stat' | 'graph' | 'knob';

export interface DropAnchors {
  toDisplayIndex: number;
  targetGroupId: string | undefined;
  anchorBeforeId?: string | null;
  anchorAfterId?: string | null;
  anchorHeaderGroupId?: string | null;
  anchorBeforeHeaderGroupId?: string | null;
  anchorAfterHeaderGroupId?: string | null;
  boundary?: 'top' | 'bottom';
}

export type LayerDropIntent =
  | {
      kind: 'items';
      mode: string;
      draggedIds: string[];
      anchors: DropAnchors;
      preserveFullGroups: boolean;
      collapsedGroupIds: string[];
    }
  | {
      kind: 'group';
      mode: string;
      groupId: string;
      extraIds: string[];
      anchors: DropAnchors;
      collapsedGroupIds: string[];
    };

export const resolveDropIndexFromAnchors = (
  target: DropAnchors,
  draggedSet: ReadonlySet<string>,
  display: DisplayItem[],
): number | null => {
  if (
    target.targetGroupId &&
    !display.some(
      (item) =>
        item.displayType === 'group-header' &&
        item.groupId === target.targetGroupId,
    )
  ) {
    return null;
  }
  if (target.anchorHeaderGroupId) {
    const headerIndex = display.findIndex(
      (item) =>
        item.displayType === 'group-header' &&
        item.groupId === target.anchorHeaderGroupId,
    );
    return headerIndex === -1 ? null : headerIndex + 1;
  }
  const findLayerIndex = (id: string | null | undefined): number =>
    id == null || draggedSet.has(id)
      ? -1
      : display.findIndex(
          (item) => item.displayType === 'layer' && item.item.id === id,
        );
  const findHeaderIndex = (groupId: string | null | undefined): number =>
    groupId == null
      ? -1
      : display.findIndex(
          (item) =>
            item.displayType === 'group-header' && item.groupId === groupId,
        );
  const beforeCaptured =
    target.anchorBeforeId != null || target.anchorBeforeHeaderGroupId != null;
  const afterCaptured =
    target.anchorAfterId != null || target.anchorAfterHeaderGroupId != null;
  const beforeIndex =
    target.anchorBeforeId != null
      ? findLayerIndex(target.anchorBeforeId)
      : findHeaderIndex(target.anchorBeforeHeaderGroupId);
  const afterIndex =
    target.anchorAfterId != null
      ? findLayerIndex(target.anchorAfterId)
      : findHeaderIndex(target.anchorAfterHeaderGroupId);
  if (beforeCaptured && afterCaptured) {
    if (beforeIndex !== -1 && afterIndex !== -1) {
      if (beforeIndex >= afterIndex) return null;
      for (let index = beforeIndex + 1; index < afterIndex; index += 1) {
        const item = display[index];
        if (item.displayType === 'group-header') return null;
        if (item.displayType === 'layer' && !draggedSet.has(item.item.id)) {
          return null;
        }
      }
      return beforeIndex + 1;
    }
    if (beforeIndex !== -1) return beforeIndex + 1;
    if (afterIndex !== -1) return afterIndex;
    return null;
  }
  if (beforeCaptured) return beforeIndex === -1 ? null : beforeIndex + 1;
  if (afterCaptured) return afterIndex === -1 ? null : afterIndex;
  if (target.boundary === 'top') return 0;
  if (target.boundary === 'bottom') return display.length;
  return target.toDisplayIndex;
};

interface ReorderPlan {
  orderedItems: LayerItem[];
  movedIds: Set<string>;
  groupIdByMovedId: Map<string, string | undefined>;
}

const reorderAtDisplayIndex = (
  items: LayerItem[],
  display: DisplayItem[],
  movingIds: Set<string>,
  displayIndex: number,
  targetGroupId: string | undefined,
  preserveFullGroups: boolean,
): ReorderPlan | null => {
  const moving = items.filter((item) => movingIds.has(item.id));
  if (moving.length !== movingIds.size) return null;
  const remaining = items.filter((item) => !movingIds.has(item.id));
  const groupMembers = new Map<string, Set<string>>();
  items.forEach((item) => {
    if (!item.groupId) return;
    const ids = groupMembers.get(item.groupId) ?? new Set<string>();
    ids.add(item.id);
    groupMembers.set(item.groupId, ids);
  });
  const isFullGroupMoved = (groupId: string): boolean => {
    const members = groupMembers.get(groupId);
    return !!members && [...members].every((id) => movingIds.has(id));
  };
  let offset = 0;
  for (
    let index = 0;
    index < displayIndex && index < display.length;
    index += 1
  ) {
    const item = display[index];
    if (item.displayType === 'layer' && movingIds.has(item.item.id))
      offset += 1;
    if (item.displayType === 'group-header' && isFullGroupMoved(item.groupId)) {
      offset += 1;
    }
  }
  const filteredIndex = displayIndex - offset;
  const filteredDisplay = display.filter((item) => {
    if (item.displayType === 'layer') return !movingIds.has(item.item.id);
    return !isFullGroupMoved(item.groupId);
  });
  const orderedRemaining: LayerItem[] = [];
  const added = new Set<string>();
  filteredDisplay.forEach((item) => {
    if (item.displayType === 'layer') {
      const found = remaining.find(
        (candidate) => candidate.id === item.item.id,
      );
      if (found && !added.has(found.id)) {
        orderedRemaining.push(found);
        added.add(found.id);
      }
      return;
    }
    remaining.forEach((candidate) => {
      if (candidate.groupId === item.groupId && !added.has(candidate.id)) {
        orderedRemaining.push(candidate);
        added.add(candidate.id);
      }
    });
  });
  remaining.forEach((item) => {
    if (!added.has(item.id)) orderedRemaining.push(item);
  });
  let insertionIndex = orderedRemaining.length;
  if (filteredIndex < filteredDisplay.length) {
    const target = filteredDisplay[filteredIndex];
    if (target.displayType === 'layer') {
      const index = orderedRemaining.findIndex(
        (item) => item.id === target.item.id,
      );
      if (index !== -1) insertionIndex = index;
    } else {
      const index = orderedRemaining.findIndex(
        (item) => item.groupId === target.groupId,
      );
      if (index !== -1) insertionIndex = index;
    }
  }
  const groupIdByMovedId = new Map<string, string | undefined>();
  const updatedMoving = moving.map((item) => {
    if (item.type === 'plugin') return item;
    const groupId =
      preserveFullGroups && item.groupId && isFullGroupMoved(item.groupId)
        ? item.groupId
        : targetGroupId;
    groupIdByMovedId.set(item.id, groupId);
    return { ...item, groupId };
  });
  return {
    orderedItems: [
      ...orderedRemaining.slice(0, insertionIndex),
      ...updatedMoving,
      ...orderedRemaining.slice(insertionIndex),
    ],
    movedIds: movingIds,
    groupIdByMovedId,
  };
};

const modelFrom = (
  mode: string,
  document: EditorDocumentV1,
  pluginElements: readonly PluginDisplayElementInternal[],
  collapsedGroupIds: readonly string[],
): { items: LayerItem[]; display: DisplayItem[] } => {
  const items = buildLayerItemsForMode(
    mode,
    document.keyPositions,
    document.statPositions,
    document.graphPositions,
    document.knobPositions,
    [...pluginElements],
  ).map(
    (item): LayerItem => ({
      ...item,
      name: item.id,
      hidden: false,
    }),
  );
  return {
    items,
    display: buildDisplayItems({
      layerItems: items,
      layerGroupsForMode: document.layerGroups[mode] ?? [],
      collapsedGroups: new Set(collapsedGroupIds),
      defaultGroupName: '',
    }),
  };
};

const resolvePlan = (
  descriptor: LayerDropIntent,
  document: EditorDocumentV1,
  pluginElements: readonly PluginDisplayElementInternal[],
): ReorderPlan => {
  const model = modelFrom(
    descriptor.mode,
    document,
    pluginElements,
    descriptor.collapsedGroupIds,
  );
  let movingIds: Set<string>;
  let preserveFullGroups: boolean;
  let targetGroupId = descriptor.anchors.targetGroupId;
  if (descriptor.kind === 'group') {
    const groupMembers = model.items
      .filter((item) => item.groupId === descriptor.groupId)
      .map((item) => item.id);
    if (groupMembers.length === 0)
      throw new ElementIntentAbort('dragged group missing');
    movingIds = new Set([...groupMembers, ...descriptor.extraIds]);
    preserveFullGroups = true;
  } else {
    movingIds = new Set(descriptor.draggedIds);
    preserveFullGroups = descriptor.preserveFullGroups;
  }
  if (movingIds.size === 0)
    throw new ElementIntentAbort('dragged elements missing');
  const displayIndex = resolveDropIndexFromAnchors(
    descriptor.anchors,
    movingIds,
    model.display,
  );
  if (displayIndex === null) throw new ElementIntentAbort('drop anchors stale');
  if (descriptor.kind === 'group' && descriptor.extraIds.length > 0) {
    const before = model.display[displayIndex - 1];
    const after = model.display[displayIndex];
    targetGroupId =
      before?.displayType === 'group-header'
        ? before.groupId
        : before?.displayType === 'layer' && before.item.groupId
        ? before.item.groupId
        : after?.displayType === 'layer'
        ? after.item.groupId
        : undefined;
  }
  const plan = reorderAtDisplayIndex(
    model.items,
    model.display,
    movingIds,
    displayIndex,
    targetGroupId,
    preserveFullGroups,
  );
  if (!plan) throw new ElementIntentAbort('dragged elements changed');
  return plan;
};

const opFromPlan = (
  mode: string,
  plan: ReorderPlan,
): EditorReorderElementsOpV1 | null => {
  const zUpdates: EditorReorderElementsOpV1['zUpdates'] = [];
  const groupUpdates: EditorReorderElementsOpV1['groupUpdates'] = [];
  const maxZIndex = plan.orderedItems.length - 1;
  plan.orderedItems.forEach((item, index) => {
    if (item.type === 'plugin') return;
    if (!item.id || /^(key|stat|graph|knob)-\d+$/.test(item.id)) {
      throw new ElementIntentAbort('synthetic reorder target');
    }
    zUpdates.push({
      elementType: item.type,
      id: item.id,
      zIndex: maxZIndex - index,
    });
    if (plan.groupIdByMovedId.has(item.id)) {
      groupUpdates.push({
        elementType: item.type,
        id: item.id,
        groupId: plan.groupIdByMovedId.get(item.id) ?? null,
      });
    }
  });
  if (zUpdates.length === 0 && groupUpdates.length === 0) return null;
  return {
    kind: 'reorderElements',
    mode,
    zUpdates,
    groupUpdates,
    completeModeOrder: true,
  };
};

const desiredPluginsFromPlan = (
  mode: string,
  plan: ReorderPlan,
  pluginProjection: readonly PluginDisplayElementInternal[],
): PluginDisplayElementInternal[] => {
  const zById = new Map<string, number>();
  const maxZIndex = plan.orderedItems.length - 1;
  plan.orderedItems.forEach((item, index) => {
    if (item.type === 'plugin') zById.set(item.id, maxZIndex - index);
  });
  return pluginProjection.map((element) => {
    if (!isPluginVisibleInMode(element, mode)) return element;
    const zIndex = zById.get(element.fullId);
    return zIndex === undefined || zIndex === element.zIndex
      ? element
      : { ...element, zIndex };
  });
};

const applyPluginZIndexesEagerly = (
  desired: readonly PluginDisplayElementInternal[],
): ElementIntentReceipt | null => {
  const desiredById = new Map(
    desired.map((element) => [element.fullId, element]),
  );
  const store = usePluginDisplayElementStore.getState();
  const entries: Array<{
    fullId: string;
    before: number | undefined;
    expected: number;
  }> = [];
  const next = store.elements.map((element) => {
    const target = desiredById.get(element.fullId);
    if (
      !target ||
      target.zIndex === element.zIndex ||
      target.zIndex === undefined
    ) {
      return element;
    }
    entries.push({
      fullId: element.fullId,
      before: element.zIndex,
      expected: target.zIndex,
    });
    return { ...element, zIndex: target.zIndex };
  });
  if (entries.length === 0) return null;
  try {
    store.setElements(next);
  } catch (error) {
    try {
      usePluginDisplayElementStore
        .getState()
        .setElements([...store.elements], { skipSync: true });
    } catch {
      // 원래 오류 보존
    }
    throw error;
  }
  return {
    rollback: () => {
      const currentStore = usePluginDisplayElementStore.getState();
      const beforeById = new Map(entries.map((entry) => [entry.fullId, entry]));
      let touched = false;
      const restored = currentStore.elements.map((element) => {
        const entry = beforeById.get(element.fullId);
        if (!entry || element.zIndex !== entry.expected) return element;
        touched = true;
        return { ...element, zIndex: entry.before };
      });
      if (touched) currentStore.setElements(restored);
    },
  };
};

const localDocument = (): EditorDocumentV1 => ({
  schemaVersion: 1,
  keys: useKeyStore.getState().keyMappings,
  keyPositions: useKeyStore.getState().canonicalPositions,
  statPositions: useStatItemStore.getState().positions,
  graphPositions: useGraphItemStore.getState().positions,
  knobPositions: useKnobItemStore.getState().positions,
  layerGroups: useLayerGroupStore.getState().layerGroups,
});

export const commitLayerDropIntent = async (
  descriptor: LayerDropIntent,
  options?: { expectedAuthorityGeneration?: number },
): Promise<void> => {
  const assertAuthorityGeneration = () => {
    if (
      options?.expectedAuthorityGeneration !== undefined &&
      options.expectedAuthorityGeneration !== getPluginAuthorityGeneration()
    ) {
      throw new Error('plugin authority generation changed');
    }
  };
  assertAuthorityGeneration();
  const gestureId = crypto.randomUUID();
  const initialPlugins = usePluginDisplayElementStore.getState().elements;
  const initialPlan = resolvePlan(descriptor, localDocument(), initialPlugins);
  const initialDesiredPlugins = desiredPluginsFromPlan(
    descriptor.mode,
    initialPlan,
    initialPlugins,
  );
  const initialPluginIds = [
    ...new Set(
      initialPlugins
        .filter((element) => isPluginVisibleInMode(element, descriptor.mode))
        .map((element) => element.pluginId),
    ),
  ];
  let receipt: ElementIntentReceipt | null = null;
  let runnerStarted = false;
  try {
    if (initialPluginIds.length > 0) {
      beginMixedGestureTransaction(gestureId, initialPluginIds);
      initialPluginIds.forEach((pluginId) =>
        rotatePluginInstancesEditSession(pluginId, gestureId),
      );
    }
    const initialOp = opFromPlan(descriptor.mode, initialPlan);
    const nativeIntents = new Map<
      NativeType,
      Map<string, Record<string, unknown>>
    >();
    initialOp?.zUpdates.forEach((update) => {
      const byId = nativeIntents.get(update.elementType) ?? new Map();
      byId.set(update.id, { zIndex: update.zIndex });
      nativeIntents.set(update.elementType, byId);
    });
    initialOp?.groupUpdates.forEach((update) => {
      const byId = nativeIntents.get(update.elementType) ?? new Map();
      byId.set(update.id, {
        ...(byId.get(update.id) ?? {}),
        groupId: update.groupId ?? undefined,
      });
      nativeIntents.set(update.elementType, byId);
    });
    receipt = applyPropertyIntentsEagerly(nativeIntents);
    receipt = combineReceipts(
      receipt,
      applyPluginZIndexesEagerly(initialDesiredPlugins),
    );
    runnerStarted = true;
    await runMixedGestureElementIntent({
      gestureId,
      initialPluginIds,
      pluginScope: (elements) =>
        elements
          .filter((element) => isPluginVisibleInMode(element, descriptor.mode))
          .map((element) => element.pluginId),
      receipt,
      generate: ({ base, pluginProjection }) => {
        assertAuthorityGeneration();
        const plan = resolvePlan(descriptor, base, pluginProjection);
        const op = opFromPlan(descriptor.mode, plan);
        const desiredPluginProjection = desiredPluginsFromPlan(
          descriptor.mode,
          plan,
          pluginProjection,
        );
        if (!op) {
          return { kind: 'patch', patch: null, desiredPluginProjection };
        }
        return { kind: 'ops', ops: [op], desiredPluginProjection };
      },
      skipContext: 'layer drop settlement',
      retryEditorOnly: false,
      expectedAuthorityGeneration: options?.expectedAuthorityGeneration,
    });
    assertAuthorityGeneration();
  } catch (error) {
    if (!runnerStarted) receipt?.rollback();
    throw error;
  } finally {
    cancelUncommittedMixedGestureTransaction(gestureId);
  }
};
