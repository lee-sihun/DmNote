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
} from '@src/renderer/editor/runtime/intent/elementIntent';
import { runMixedGestureElementIntent } from '@src/renderer/editor/runtime/intent/mixedElementIntent';
import {
  beginMixedGestureTransaction,
  cancelUncommittedMixedGestureTransaction,
} from '@plugins/runtime/displayElement/gestureTransaction';
import { rotatePluginInstancesEditSession } from '@plugins/runtime/displayElement/instancesCommitQueue';
import { getPluginAuthorityGeneration } from '@plugins/runtime/pluginAuthorityGeneration';
import {
  buildLayerItemsForMode,
  isPluginGroupMemberInMode,
  isPluginVisibleInMode,
} from '@utils/layerGroupUtils';
import { buildDisplayItems } from './layerPanelModel';
import { isNativeElementId } from '@src/renderer/editor/model/elementId';
import { assertCanonicalEditorDocument } from '@src/types/editor';

import type {
  CanonicalEditorDocumentV1,
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
  // 앵커도 경계도 없는 타깃은 무커밋 - 앱 내부에선 항상 앵커가 채워지므로
  // wire의 all-null 앵커만 도달하며 숫자 index로 fail-open하지 않는다
  return null;
};

interface ReorderPlan {
  orderedItems: LayerItem[];
  movedIds: Set<string>;
  groupIdByMovedId: Map<string, string | undefined>;
}

// 그룹 id 성격 인자 2개가 positional로 섞이지 않도록 옵션 객체로 전달
interface ReorderGroupOptions {
  targetGroupId: string | undefined;
  preserveFullGroups: boolean;
  intoGroupId?: string;
}

const reorderAtDisplayIndex = (
  items: LayerItem[],
  display: DisplayItem[],
  movingIds: Set<string>,
  displayIndex: number,
  { targetGroupId, preserveFullGroups, intoGroupId }: ReorderGroupOptions,
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
  // 헤더 진입은 접힘 여부와 무관하게 그룹 처음 삽입 - 접힌 그룹은 자식 행이
  // 없어 슬롯 치환이 그룹 다음을 가리키므로 남은 멤버 기준으로 직접 해석
  const intoFirstIndex =
    intoGroupId != null
      ? orderedRemaining.findIndex((item) => item.groupId === intoGroupId)
      : -1;
  if (intoFirstIndex !== -1) {
    insertionIndex = intoFirstIndex;
  } else if (filteredIndex < filteredDisplay.length) {
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
  // 플러그인도 그룹 소속 이동에 참여 - op는 native만, 플러그인 소속은
  // desired projection(pluginChanges)이 운반한다
  const groupIdByMovedId = new Map<string, string | undefined>();
  const updatedMoving = moving.map((item) => {
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
  document: CanonicalEditorDocumentV1,
  pluginElements: readonly PluginDisplayElementInternal[],
  collapsedGroupIds: readonly string[],
): { items: LayerItem[]; display: DisplayItem[] } => {
  // 패널 표시 모델과 동일하게 현재 모드 def가 없는 groupId는 무소속 취급 -
  // dangling 소속이 유령 헤더 행을 만들어 앵커 해석이 어긋나는 것을 방지
  const validGroupIds = new Set(
    (document.layerGroups[mode] ?? []).map((group) => group.id),
  );
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
      groupId:
        item.groupId && validGroupIds.has(item.groupId)
          ? item.groupId
          : undefined,
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

// 슬롯 위 이웃이 허용하는 소속 - 펼친 헤더 바로 아래는 그룹 처음,
// 접힌 헤더 아래는 그룹 전체 다음 바깥이라 무소속
const membershipFromAbove = (
  row: DisplayItem | undefined,
): string | undefined => {
  if (!row) return undefined;
  if (row.displayType === 'group-header') {
    return row.isCollapsed ? undefined : row.groupId;
  }
  return row.item.groupId;
};

const membershipFromBelow = (
  row: DisplayItem | undefined,
): string | undefined =>
  row?.displayType === 'layer' ? row.item.groupId : undefined;

// 이동 집합을 제외한 슬롯 이웃 판독 - 드래그 중인 layer 행 자신을 이웃으로
// 읽으면 낡은 소속이 판독된다 (앵커 캡처와 같은 규약). 전 멤버가 이동하는
// 그룹의 헤더도 드롭 후 그 자리에 남지 않으므로 함께 건너뛴다
const scanDropNeighbor = (
  display: DisplayItem[],
  start: number,
  step: -1 | 1,
  movingIds: ReadonlySet<string>,
  isFullGroupMoved: (groupId: string) => boolean,
): DisplayItem | undefined => {
  for (let index = start; index >= 0 && index < display.length; index += step) {
    const row = display[index];
    if (row.displayType === 'layer') {
      if (!movingIds.has(row.item.id)) return row;
      continue;
    }
    if (!isFullGroupMoved(row.groupId)) return row;
  }
  return undefined;
};

// 아이템 드롭의 그룹 판정을 live 모델로 재유도. 캡처는 포인터가 올라간 행
// 기준이라 같은 슬롯에서도 안·밖 의도가 갈리므로, 슬롯 이웃이 여전히
// 허용하는 소속이면 캡처 의도를 유지한다. 앵커 행이 그 사이 그룹을 떠나
// 캡처 값이 이웃과 어긋나면 위 이웃 기준으로 다시 유도해 사용자가 넣은 적
// 없는 그룹 편입을 막는다
const rederiveItemTargetGroupId = (
  above: DisplayItem | undefined,
  below: DisplayItem | undefined,
  captured: string | undefined,
): string | undefined => {
  const aboveMembership = membershipFromAbove(above);
  const belowMembership = membershipFromBelow(below);
  if (captured === aboveMembership || captured === belowMembership) {
    return captured;
  }
  return aboveMembership;
};

const resolvePlan = (
  descriptor: LayerDropIntent,
  document: CanonicalEditorDocumentV1,
  pluginElements: readonly PluginDisplayElementInternal[],
): ReorderPlan => {
  assertCanonicalEditorDocument(document, 'layer reorder document');
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
  const isFullGroupMoved = (groupId: string): boolean => {
    const members = model.items.filter((item) => item.groupId === groupId);
    return (
      members.length > 0 && members.every((item) => movingIds.has(item.id))
    );
  };
  const neighborAbove = scanDropNeighbor(
    model.display,
    displayIndex - 1,
    -1,
    movingIds,
    isFullGroupMoved,
  );
  const neighborBelow = scanDropNeighbor(
    model.display,
    displayIndex,
    1,
    movingIds,
    isFullGroupMoved,
  );
  if (descriptor.kind === 'group' && descriptor.extraIds.length > 0) {
    const before = neighborAbove;
    const after = neighborBelow;
    targetGroupId =
      before?.displayType === 'group-header'
        ? before.groupId
        : before?.displayType === 'layer' && before.item.groupId
        ? before.item.groupId
        : after?.displayType === 'layer'
        ? after.item.groupId
        : undefined;
  } else if (
    descriptor.kind === 'items' &&
    !descriptor.anchors.anchorHeaderGroupId
  ) {
    // 헤더 진입은 그룹 편입이 명시적 의도라 재유도에서 제외 - 헤더 생존은
    // 앵커 해석이 이미 확인했다
    targetGroupId = rederiveItemTargetGroupId(
      neighborAbove,
      neighborBelow,
      targetGroupId,
    );
  }
  const plan = reorderAtDisplayIndex(
    model.items,
    model.display,
    movingIds,
    displayIndex,
    {
      targetGroupId,
      preserveFullGroups,
      intoGroupId: descriptor.anchors.anchorHeaderGroupId ?? undefined,
    },
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
    if (!isNativeElementId(item.id)) {
      throw new ElementIntentAbort('invalid native reorder target');
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
    let next = element;
    const zIndex = zById.get(element.fullId);
    if (zIndex !== undefined && zIndex !== element.zIndex) {
      next = { ...next, zIndex };
    }
    // 그룹 소속 이동 반영 - 저장 규칙 밖 모드의 소속 변경은 dangling이 되므로 제외
    if (
      plan.groupIdByMovedId.has(element.fullId) &&
      isPluginGroupMemberInMode(element, mode)
    ) {
      const groupId = plan.groupIdByMovedId.get(element.fullId);
      if (groupId !== next.groupId) {
        next = { ...next, groupId };
      }
    }
    return next;
  });
};

interface PluginEagerFieldEntry {
  fullId: string;
  field: 'zIndex' | 'groupId';
  before: number | string | undefined;
  expected: number | string | undefined;
}

// zIndex·groupId eager 반영 - 필드별 CAS receipt로 롤백
const applyPluginLayerFieldsEagerly = (
  desired: readonly PluginDisplayElementInternal[],
): ElementIntentReceipt | null => {
  const desiredById = new Map(
    desired.map((element) => [element.fullId, element]),
  );
  const store = usePluginDisplayElementStore.getState();
  const entries: PluginEagerFieldEntry[] = [];
  const next = store.elements.map((element) => {
    const target = desiredById.get(element.fullId);
    if (!target) return element;
    let updated = element;
    if (target.zIndex !== undefined && target.zIndex !== element.zIndex) {
      entries.push({
        fullId: element.fullId,
        field: 'zIndex',
        before: element.zIndex,
        expected: target.zIndex,
      });
      updated = { ...updated, zIndex: target.zIndex };
    }
    if (target.groupId !== element.groupId) {
      entries.push({
        fullId: element.fullId,
        field: 'groupId',
        before: element.groupId,
        expected: target.groupId,
      });
      updated = { ...updated, groupId: target.groupId };
    }
    return updated;
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
      const entriesById = new Map<string, PluginEagerFieldEntry[]>();
      entries.forEach((entry) => {
        const list = entriesById.get(entry.fullId) ?? [];
        list.push(entry);
        entriesById.set(entry.fullId, list);
      });
      let touched = false;
      const restored = currentStore.elements.map((element) => {
        const list = entriesById.get(element.fullId);
        if (!list) return element;
        let nextElement = element;
        for (const entry of list) {
          // CAS: 우리가 쓴 값 그대로일 때만 복원
          const currentValue = (nextElement as Record<string, unknown>)[
            entry.field
          ];
          if (currentValue !== entry.expected) continue;
          nextElement = { ...nextElement, [entry.field]: entry.before };
          touched = true;
        }
        return nextElement;
      });
      if (touched) currentStore.setElements(restored);
    },
  };
};

const localDocument = (): CanonicalEditorDocumentV1 => ({
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
      applyPluginLayerFieldsEagerly(initialDesiredPlugins),
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
