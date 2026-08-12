/**
 * 레이어 패널 드래그 앤 드롭 훅
 * 아이템/그룹 드래그, 드롭 타깃 계산, 순서 재배치
 */

import { isSyntheticElementId } from '@src/renderer/editor/model/elementIdMap';
import {
  applyPropertyIntentsEagerly,
  intentPatch,
  reportElementOpError,
  runElementIntent,
} from '@src/renderer/editor/runtime/elementIntent';
import { setPluginElementZIndexes } from '@plugins/rpc/pluginElementActions';
import { useState, useRef } from 'react';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { normalizeLayerGroupsForMode } from '@utils/layerGroupUtils';
import { editorCoordinator } from '@src/renderer/editor/runtime/editorStateCoordinator';
import type { LayerItem, DisplayItem } from '../types';
import { createRafLatestScheduler } from '@utils/animation/rafLatestScheduler';

// ============================================================================
// 파라미터 타입
// ============================================================================

// 모드 한정 의도 재적용 - 레이어 순서는 mode-local이라 다른 모드로 이동한
// 요소에 zIndex·groupId를 쓰면 안 된다
export const generateModeScopedIntentPatch = (
  base: import('@src/types/editor').EditorDocumentV1,
  intents: ReadonlyMap<
    'key' | 'stat' | 'graph' | 'knob',
    ReadonlyMap<string, Record<string, unknown>>
  >,
  mode: string,
): import('@src/types/editor').EditorPatchV1 | null => {
  const FIELD_BY_TYPE = {
    key: 'keyPositions',
    stat: 'statPositions',
    graph: 'graphPositions',
    knob: 'knobPositions',
  } as const;
  const patch: import('@src/types/editor').EditorPatchV1 = {
    schemaVersion: 1,
  };
  let touchedAny = false;
  for (const [type, byId] of intents) {
    const field = FIELD_BY_TYPE[type];
    const record = base[field] as Record<
      string,
      Array<{ id?: string } & Record<string, unknown>>
    >;
    let touched = 0;
    const modeList = record[mode] ?? [];
    const nextList = modeList.map((position) => {
      const id = position.id;
      if (typeof id !== 'string') return position;
      const intent = byId.get(id);
      if (!intent) return position;
      touched += 1;
      return { ...position, ...intent, id };
    });
    if (touched > 0) {
      patch[field] = { ...record, [mode]: nextList } as never;
      touchedAny = true;
    }
  }
  return touchedAny ? patch : null;
};

export interface DropAnchors {
  toDisplayIndex: number;
  targetGroupId: string | undefined;
  anchorBeforeId?: string | null;
  anchorAfterId?: string | null;
  anchorHeaderGroupId?: string | null;
  // 스캔이 layer 대신 그룹 헤더 경계에서 끝난 경우의 헤더 앵커
  anchorBeforeHeaderGroupId?: string | null;
  anchorAfterHeaderGroupId?: string | null;
}

export const resolveDropIndexFromAnchors = (
  target: DropAnchors,
  draggedSet: ReadonlySet<string>,
  display: DisplayItem[],
): number | null => {
  if (
    target.targetGroupId &&
    !display.some(
      (di) =>
        di.displayType === 'group-header' &&
        di.groupId === target.targetGroupId,
    )
  ) {
    return null;
  }
  if (target.anchorHeaderGroupId) {
    const headerIdx = display.findIndex(
      (di) =>
        di.displayType === 'group-header' &&
        di.groupId === target.anchorHeaderGroupId,
    );
    return headerIdx !== -1 ? headerIdx + 1 : null;
  }
  // 이동 집합에 편입된 앵커는 소실 취급 - 함께 움직이는 요소는 고정
  // 기준점이 될 수 없다 (캡처 후 선택 확장으로 편입된 경우 포함)
  const findLayerIndex = (id: string | null | undefined): number =>
    id == null || draggedSet.has(id)
      ? -1
      : display.findIndex(
          (di) => di.displayType === 'layer' && di.item.id === id,
        );
  const findHeaderIndex = (groupId: string | null | undefined): number =>
    groupId == null
      ? -1
      : display.findIndex(
          (di) => di.displayType === 'group-header' && di.groupId === groupId,
        );
  // 각 측 앵커: layer 우선, 없으면 헤더 경계
  const beforeCaptured =
    target.anchorBeforeId != null || target.anchorBeforeHeaderGroupId != null;
  const afterCaptured =
    target.anchorAfterId != null || target.anchorAfterHeaderGroupId != null;
  const beforeIdx =
    target.anchorBeforeId != null
      ? findLayerIndex(target.anchorBeforeId)
      : findHeaderIndex(target.anchorBeforeHeaderGroupId);
  const afterIdx =
    target.anchorAfterId != null
      ? findLayerIndex(target.anchorAfterId)
      : findHeaderIndex(target.anchorAfterHeaderGroupId);
  if (beforeCaptured && afterCaptured) {
    if (beforeIdx !== -1 && afterIdx !== -1) {
      // 순서 역전 = 병행 재정렬이 두 앵커 관계를 갈랐다 - 무커밋
      if (beforeIdx >= afterIdx) return null;
      for (let i = beforeIdx + 1; i < afterIdx; i++) {
        const di = display[i];
        if (di.displayType === 'group-header') return null;
        if (di.displayType === 'layer' && !draggedSet.has(di.item.id)) {
          return null;
        }
      }
      return beforeIdx + 1;
    }
    if (beforeIdx !== -1) return beforeIdx + 1;
    if (afterIdx !== -1) return afterIdx;
    return null;
  }
  if (beforeCaptured) {
    return beforeIdx !== -1 ? beforeIdx + 1 : null;
  }
  if (afterCaptured) {
    return afterIdx !== -1 ? afterIdx : null;
  }
  // 앵커가 원래 없던 경계(빈 목록 최상단 등)는 캡처 index 유지
  return target.toDisplayIndex;
};

interface UseLayerDnDParams {
  selectedKeyType: string;
  layerItemsRef: React.MutableRefObject<LayerItem[]>;
  displayItemsRef: React.MutableRefObject<DisplayItem[]>;
  buildLiveLayerModel: () => {
    layerItems: LayerItem[];
    displayItems: DisplayItem[];
  };
  scrollElementRef: React.MutableRefObject<HTMLDivElement | null>;
  clearPendingDeselect: () => void;
}

// ============================================================================
// 훅
// ============================================================================

export function useLayerDnD({
  selectedKeyType,
  layerItemsRef,
  displayItemsRef,
  buildLiveLayerModel,
  scrollElementRef,
  clearPendingDeselect,
}: UseLayerDnDParams) {
  // 드래그 상태
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [dragOverItemDisplayIndex, setDragOverItemDisplayIndex] = useState<
    number | null
  >(null);
  const [dragOverHeaderBottomGroupId, setDragOverHeaderBottomGroupId] =
    useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [draggedGroupId, setDraggedGroupId] = useState<string | null>(null);
  const [dragOverDisplayIndex, setDragOverDisplayIndex] = useState<
    number | null
  >(null);

  // Refs
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);
  const didDragRef = useRef(false);
  const dragStateRef = useRef<{
    itemHeight: number;
    currentDropTarget: DropAnchors | null;
  } | null>(null);
  const draggedItemIdsRef = useRef<string[]>([]);
  const groupDragStateRef = useRef<{
    groupId: string;
    itemHeight: number;
    currentOverIndex: number | null;
    anchors: DropAnchors | null;
    // 앵커 후보에서 제외한 id들 - mouseup의 이동 집합과 대조해 축소 감지
    excludedIds: string[];
  } | null>(null);

  // ──────────────────────────────────────────────────────────────────────────
  // 아이템 드롭 타깃 계산
  // ──────────────────────────────────────────────────────────────────────────

  const resolveItemDropTarget = (
    displaySlotIndex: number,
    draggingItemIds: ReadonlySet<string>,
    model?: { layerItems: LayerItem[]; displayItems: DisplayItem[] },
  ) => {
    // 커밋 판정은 mouseup의 live 모델을 받는다 - ref는 드래그 중 프리뷰 전용
    const items = model?.layerItems ?? layerItemsRef.current;
    const currentDisplay = model?.displayItems ?? displayItemsRef.current;
    const safeSlotIndex = Math.max(
      0,
      Math.min(currentDisplay.length, displaySlotIndex),
    );

    let toIndex = items.length;
    if (safeSlotIndex < currentDisplay.length) {
      const targetDisplayItem = currentDisplay[safeSlotIndex];
      if (targetDisplayItem.displayType === 'layer') {
        toIndex = targetDisplayItem.flatIndex;
      } else {
        const firstChildIndex = items.findIndex(
          (item) => item.groupId === targetDisplayItem.groupId,
        );
        toIndex = firstChildIndex === -1 ? items.length : firstChildIndex;
      }
    }

    const getDisplayItem = (index: number): DisplayItem | undefined =>
      index >= 0 && index < currentDisplay.length
        ? currentDisplay[index]
        : undefined;

    let prevIdx = safeSlotIndex - 1;
    while (prevIdx >= 0) {
      const di = getDisplayItem(prevIdx);
      if (di?.displayType !== 'layer' || !draggingItemIds.has(di.item.id))
        break;
      prevIdx--;
    }
    const prevDisplayItem = getDisplayItem(prevIdx);

    let nextIdx = safeSlotIndex;
    while (nextIdx < currentDisplay.length) {
      const di = getDisplayItem(nextIdx);
      if (di?.displayType !== 'layer' || !draggingItemIds.has(di.item.id))
        break;
      nextIdx++;
    }
    const nextDisplayItem = getDisplayItem(nextIdx);

    let targetGroupId: string | undefined;
    if (prevDisplayItem?.displayType === 'group-header') {
      const prevHeaderGroupId = prevDisplayItem.groupId;
      if (
        nextDisplayItem?.displayType === 'layer' &&
        nextDisplayItem.item.groupId === prevHeaderGroupId
      ) {
        targetGroupId = prevHeaderGroupId;
      } else if (!nextDisplayItem) {
        targetGroupId = prevHeaderGroupId;
      } else {
        targetGroupId = undefined;
      }
    } else {
      const prevGroupId =
        prevDisplayItem?.displayType === 'layer'
          ? prevDisplayItem.item.groupId
          : undefined;

      if (prevGroupId) {
        targetGroupId = prevGroupId;
      } else {
        targetGroupId = undefined;
      }
    }

    return { toIndex, targetGroupId };
  };

  // 포인터 위치 기반 드롭 타깃 계산
  const resolveItemDropTargetFromPointer = (
    relativeY: number,
    itemHeight: number,
    draggingIds: ReadonlySet<string>,
  ) => {
    const currentDisplay = displayItemsRef.current;
    const displayCount = currentDisplay.length;

    if (displayCount === 0) {
      const target = resolveItemDropTarget(0, draggingIds);
      return {
        ...target,
        indicatorDisplayIndex: 0,
        indicatorHeaderBottomGroupId: null,
      };
    }

    if (relativeY <= 0) {
      const target = resolveItemDropTarget(0, draggingIds);
      return {
        ...target,
        indicatorDisplayIndex: 0,
        indicatorHeaderBottomGroupId: null,
      };
    }

    const totalHeight = displayCount * itemHeight;
    if (relativeY >= totalHeight) {
      const target = resolveItemDropTarget(displayCount, draggingIds);
      return {
        ...target,
        indicatorDisplayIndex: displayCount,
        indicatorHeaderBottomGroupId: null,
      };
    }

    const clampedY = relativeY;
    const rowIndex = Math.min(
      displayCount - 1,
      Math.floor(clampedY / itemHeight),
    );
    const rowTop = rowIndex * itemHeight;
    const offsetInRow = clampedY - rowTop;
    const isBottomHalf = offsetInRow >= itemHeight / 2;
    const row = currentDisplay[rowIndex];

    if (row.displayType === 'group-header' && isBottomHalf) {
      if (row.isCollapsed) {
        const firstChildIndex = layerItemsRef.current.findIndex(
          (item) => item.groupId === row.groupId,
        );
        const toIndex =
          firstChildIndex === -1
            ? layerItemsRef.current.length
            : firstChildIndex;

        return {
          toIndex,
          targetGroupId: row.groupId,
          indicatorDisplayIndex: null,
          indicatorHeaderBottomGroupId: row.groupId,
        };
      }

      const expandedGroupSlotIndex = rowIndex + 1;
      const target = resolveItemDropTarget(expandedGroupSlotIndex, draggingIds);
      return {
        ...target,
        indicatorDisplayIndex: expandedGroupSlotIndex,
        indicatorHeaderBottomGroupId: null,
      };
    }

    const displaySlotIndex =
      row.displayType === 'group-header'
        ? rowIndex
        : isBottomHalf
        ? rowIndex + 1
        : rowIndex;
    const target = resolveItemDropTarget(displaySlotIndex, draggingIds);

    return {
      ...target,
      indicatorDisplayIndex: displaySlotIndex,
      indicatorHeaderBottomGroupId: null,
    };
  };

  // ──────────────────────────────────────────────────────────────────────────
  // 다중 아이템 드롭 처리
  // ──────────────────────────────────────────────────────────────────────────

  // 앵커 소실 정책: 양생존·인접이면 사이, 하나 생존이면 그 기준, 양소실
  // 또는 비인접이면 무커밋. 그룹 헤더 앵커는 그룹이 살아 있을 때만.
  // 대상 그룹이 삭제됐으면 무커밋
  const performMultiDrop = async (
    draggedIds: string[],
    toDisplayIndex: number,
    dropContext?: {
      targetGroupId: string | undefined;
      preserveFullGroups?: boolean;
      liveModel?: { layerItems: LayerItem[]; displayItems: DisplayItem[] };
    },
  ) => {
    // 순서 계산 입력도 authoritative 재구성 목록 - effect 지연 ref 금지
    const liveModel = dropContext?.liveModel ?? buildLiveLayerModel();
    const items = [...liveModel.layerItems];
    const currentDisplay = liveModel.displayItems;
    // 대상 그룹이 mouseup까지 살아있는지 최종 검증 - 삭제됐으면 ghost
    // groupId 커밋 대신 무커밋 (anchors 해석을 안 거치는 호출 경로 방어)
    if (dropContext?.targetGroupId) {
      const targetAlive =
        currentDisplay.some(
          (di) =>
            di.displayType === 'group-header' &&
            di.groupId === dropContext.targetGroupId,
        ) || items.some((item) => item.groupId === dropContext.targetGroupId);
      if (!targetAlive) return;
    }
    const draggedIdSet = new Set(draggedIds);

    const draggedItems = items.filter((item) => draggedIdSet.has(item.id));
    const remainingItems = items.filter((item) => !draggedIdSet.has(item.id));

    if (draggedItems.length === 0) return;

    // 그룹별 멤버 맵
    const groupMemberIds = new Map<string, Set<string>>();
    for (const item of items) {
      if (item.groupId) {
        let memberSet = groupMemberIds.get(item.groupId);
        if (!memberSet) {
          memberSet = new Set();
          groupMemberIds.set(item.groupId, memberSet);
        }
        memberSet.add(item.id);
      }
    }

    const isFullGroupDragged = (groupId: string): boolean => {
      const members = groupMemberIds.get(groupId);
      if (!members) return false;
      for (const id of members) {
        if (!draggedIdSet.has(id)) return false;
      }
      return true;
    };

    // 필터 타겟 인덱스 계산
    let offset = 0;
    for (let i = 0; i < toDisplayIndex && i < currentDisplay.length; i++) {
      const di = currentDisplay[i];
      if (di.displayType === 'layer' && draggedIdSet.has(di.item.id)) {
        offset++;
      } else if (
        di.displayType === 'group-header' &&
        isFullGroupDragged(di.groupId)
      ) {
        offset++;
      }
    }
    const filteredTargetIndex = toDisplayIndex - offset;

    // 필터 디스플레이 목록
    const filteredDisplay = currentDisplay.filter((di) => {
      if (di.displayType === 'layer' && draggedIdSet.has(di.item.id))
        return false;
      if (di.displayType === 'group-header' && isFullGroupDragged(di.groupId))
        return false;
      return true;
    });

    // remainingItems를 display 순서로 재정렬
    const orderedRemaining: LayerItem[] = [];
    const addedIds = new Set<string>();
    for (const di of filteredDisplay) {
      if (di.displayType === 'layer') {
        const item = remainingItems.find((ri) => ri.id === di.item.id);
        if (item && !addedIds.has(item.id)) {
          orderedRemaining.push(item);
          addedIds.add(item.id);
        }
      } else if (di.displayType === 'group-header') {
        for (const item of remainingItems) {
          if (item.groupId === di.groupId && !addedIds.has(item.id)) {
            orderedRemaining.push(item);
            addedIds.add(item.id);
          }
        }
      }
    }
    for (const item of remainingItems) {
      if (!addedIds.has(item.id)) {
        orderedRemaining.push(item);
        addedIds.add(item.id);
      }
    }

    // 삽입 위치 결정
    let insertionIndex = orderedRemaining.length;
    if (filteredTargetIndex < filteredDisplay.length) {
      const targetDI = filteredDisplay[filteredTargetIndex];
      if (targetDI.displayType === 'layer') {
        const idx = orderedRemaining.findIndex(
          (i) => i.id === targetDI.item.id,
        );
        if (idx !== -1) insertionIndex = idx;
      } else if (targetDI.displayType === 'group-header') {
        const firstChild = orderedRemaining.find(
          (i) => i.groupId === targetDI.groupId,
        );
        if (firstChild) {
          const idx = orderedRemaining.indexOf(firstChild);
          if (idx !== -1) insertionIndex = idx;
        }
      }
    }

    // 새 groupId 결정
    let newGroupId: string | undefined;
    if (dropContext) {
      newGroupId = dropContext.targetGroupId;
    } else {
      const prevItem = orderedRemaining[insertionIndex - 1];
      const nextItem = orderedRemaining[insertionIndex];
      if (
        prevItem?.groupId &&
        nextItem?.groupId &&
        prevItem.groupId === nextItem.groupId
      ) {
        newGroupId = prevItem.groupId;
      } else if (prevItem?.groupId && !nextItem?.groupId) {
        newGroupId = prevItem.groupId;
      } else {
        newGroupId = undefined;
      }
    }

    // 전체 그룹 드래그 시 groupId 보존
    const preserveGroupIds = new Set<string>();
    if (dropContext?.preserveFullGroups) {
      for (const item of draggedItems) {
        if (item.groupId && isFullGroupDragged(item.groupId)) {
          preserveGroupIds.add(item.id);
        }
      }
    }

    // 드래그 아이템에 groupId 적용
    const updatedDraggedItems = draggedItems.map((item) => {
      if (item.type === 'plugin') return item;
      if (preserveGroupIds.has(item.id)) return item;
      return { ...item, groupId: newGroupId };
    });

    // 새 순서 구성
    const newItems = [
      ...orderedRemaining.slice(0, insertionIndex),
      ...updatedDraggedItems,
      ...orderedRemaining.slice(insertionIndex),
    ];

    // 변경 여부 확인
    const orderChanged = newItems.some(
      (item, idx) => item.id !== items[idx]?.id,
    );
    const groupChanged = draggedItems.some(
      (orig, i) => orig.groupId !== updatedDraggedItems[i].groupId,
    );
    if (!orderChanged && !groupChanged) return;

    // 새 표시 순서를 id 의도로 변환 - effect 지연 ref의 item.index로 현재
    // 배열을 인덱싱하면 canonical 적용과 effect 사이 창에서 다른 요소를
    // 수정한다. 적용은 전부 position.id 매칭
    const maxZIndex = newItems.length - 1;
    const pluginZIndexUpdates: Array<{ fullId: string; zIndex: number }> = [];
    const nativeIntents = new Map<
      'key' | 'stat' | 'graph' | 'knob',
      Map<string, Record<string, unknown>>
    >();
    newItems.forEach((item, idx) => {
      const newZIndex = maxZIndex - idx;
      if (item.type === 'plugin') {
        pluginZIndexUpdates.push({ fullId: item.id, zIndex: newZIndex });
        return;
      }
      const intent: Record<string, unknown> = { zIndex: newZIndex };
      if (draggedIdSet.has(item.id) && !preserveGroupIds.has(item.id)) {
        intent.groupId = newGroupId;
      }
      const byId = nativeIntents.get(item.type) ?? new Map();
      byId.set(item.id, intent);
      nativeIntents.set(item.type, byId);
    });

    const modeNativeOnly = items.every(
      (item) =>
        item.type !== 'plugin' &&
        item.id.length > 0 &&
        !isSyntheticElementId(item.id),
    );

    if (modeNativeOnly) {
      // native 전용: eager·receipt는 속성 의도가 소유하고, layerGroups
      // 정규화는 슬롯의 base+의도에서 재계산해 생성 patch에만 싣는다
      // (편입 시 낙관 적용이 그룹 정의를 반영)
      void runElementIntent({
        applyEager: () => applyPropertyIntentsEagerly(nativeIntents),
        generate: (base) => {
          // 모드 한정 재적용 - 대기 중 다른 모드로 이동한 요소는 skip
          const propertyPatch = generateModeScopedIntentPatch(
            base,
            nativeIntents,
            selectedKeyType,
          );
          if (!propertyPatch) return { kind: 'targetLost' };
          const renormalized = normalizeLayerGroupsForMode({
            mode: selectedKeyType,
            keyPositions: (propertyPatch.keyPositions ??
              base.keyPositions) as never,
            statPositions: (propertyPatch.statPositions ??
              base.statPositions) as never,
            graphPositions: (propertyPatch.graphPositions ??
              base.graphPositions) as never,
            knobPositions: (propertyPatch.knobPositions ??
              base.knobPositions) as never,
            layerGroups: base.layerGroups as never,
          });
          return intentPatch({
            schemaVersion: 1,
            keyPositions: renormalized.keyPositions as never,
            statPositions: renormalized.statPositions as never,
            graphPositions: renormalized.graphPositions as never,
            knobPositions: renormalized.knobPositions as never,
            ...(renormalized.groupsChanged
              ? { layerGroups: renormalized.layerGroups as never }
              : {}),
          });
        },
      }).catch(reportElementOpError);
      return;
    }

    // plugin 포함 모드: 기존 full-record 경로 유지 (id 매칭 적용으로 개선)
    const applyIntentsToMode = <T extends { id?: string }>(
      record: Record<string, T[]>,
      type: 'key' | 'stat' | 'graph' | 'knob',
    ): Record<string, T[]> => {
      const byId = nativeIntents.get(type);
      if (!byId || byId.size === 0) return record;
      return {
        ...record,
        [selectedKeyType]: (record[selectedKeyType] ?? []).map((position) => {
          const id = position.id;
          if (typeof id !== 'string') return position;
          const intent = byId.get(id);
          return intent ? { ...position, ...intent, id } : position;
        }),
      };
    };

    const updatedPositions = applyIntentsToMode(
      useKeyStore.getState().canonicalPositions,
      'key',
    );
    const updatedStatPositions = applyIntentsToMode(
      useStatItemStore.getState().positions,
      'stat',
    );
    const updatedGraphPositions = applyIntentsToMode(
      useGraphItemStore.getState().positions,
      'graph',
    );
    const updatedKnobPositions = applyIntentsToMode(
      useKnobItemStore.getState().positions,
      'knob',
    );
    const currentLayerGroups = useLayerGroupStore.getState().layerGroups;

    const normalized = normalizeLayerGroupsForMode({
      mode: selectedKeyType,
      keyPositions: updatedPositions,
      statPositions: updatedStatPositions,
      graphPositions: updatedGraphPositions,
      knobPositions: updatedKnobPositions,
      layerGroups: currentLayerGroups,
    });

    useGraphItemStore.getState().setPositions(normalized.graphPositions);
    useKeyStore.getState().setPositions(normalized.keyPositions);
    useStatItemStore.getState().setPositions(normalized.statPositions);
    useKnobItemStore.getState().setPositions(normalized.knobPositions);
    setPluginElementZIndexes(pluginZIndexUpdates);
    if (normalized.groupsChanged) {
      useLayerGroupStore.getState().setLayerGroups(normalized.layerGroups);
    }

    try {
      await editorCoordinator.commitPatch({
        schemaVersion: 1,
        keyPositions: normalized.keyPositions,

        statPositions: normalized.statPositions,
        graphPositions: normalized.graphPositions,
        knobPositions: normalized.knobPositions,
        layerGroups: normalized.layerGroups,
      });
    } catch (error) {
      console.error('Failed to reorder layers', error);
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // 그룹 드롭 처리
  // ──────────────────────────────────────────────────────────────────────────

  const performGroupDrop = async (
    groupId: string,
    targetDisplayIndex: number,
    liveModelInput?: { layerItems: LayerItem[]; displayItems: DisplayItem[] },
  ) => {
    const liveModel = liveModelInput ?? buildLiveLayerModel();
    const items = [...liveModel.layerItems];
    const currentDisplay = liveModel.displayItems;

    const groupChildren = items.filter((item) => item.groupId === groupId);
    const remainingItems = items.filter((item) => item.groupId !== groupId);

    if (groupChildren.length === 0) return;

    let offset = 0;
    for (let i = 0; i < targetDisplayIndex && i < currentDisplay.length; i++) {
      const di = currentDisplay[i];
      if (di.displayType === 'group-header' && di.groupId === groupId) offset++;
      else if (di.displayType === 'layer' && di.item.groupId === groupId)
        offset++;
    }
    const filteredTargetIndex = targetDisplayIndex - offset;

    const filteredDisplay = currentDisplay.filter((di) => {
      if (di.displayType === 'group-header' && di.groupId === groupId)
        return false;
      if (di.displayType === 'layer' && di.item.groupId === groupId)
        return false;
      return true;
    });

    let insertionIndex = remainingItems.length;

    if (filteredTargetIndex < filteredDisplay.length) {
      const targetDI = filteredDisplay[filteredTargetIndex];
      if (targetDI.displayType === 'layer') {
        const idx = remainingItems.findIndex((i) => i.id === targetDI.item.id);
        if (idx !== -1) insertionIndex = idx;
      } else if (targetDI.displayType === 'group-header') {
        const firstChild = remainingItems.find(
          (i) => i.groupId === targetDI.groupId,
        );
        if (firstChild) {
          const idx = remainingItems.indexOf(firstChild);
          if (idx !== -1) insertionIndex = idx;
        }
      }
    }

    const newItems = [
      ...remainingItems.slice(0, insertionIndex),
      ...groupChildren,
      ...remainingItems.slice(insertionIndex),
    ];

    const orderChanged = newItems.some(
      (item, idx) => item.id !== items[idx]?.id,
    );
    if (!orderChanged) return;

    // 새 표시 순서를 id 의도로 변환 (그룹 이동은 zIndex만) - index 인덱싱 금지
    const maxZIndex = newItems.length - 1;
    const pluginZIndexUpdates: Array<{ fullId: string; zIndex: number }> = [];
    const nativeIntents = new Map<
      'key' | 'stat' | 'graph' | 'knob',
      Map<string, Record<string, unknown>>
    >();
    newItems.forEach((item, idx) => {
      const newZIndex = maxZIndex - idx;
      if (item.type === 'plugin') {
        pluginZIndexUpdates.push({ fullId: item.id, zIndex: newZIndex });
        return;
      }
      const byId = nativeIntents.get(item.type) ?? new Map();
      byId.set(item.id, { zIndex: newZIndex });
      nativeIntents.set(item.type, byId);
    });

    const modeNativeOnly = items.every(
      (item) =>
        item.type !== 'plugin' &&
        item.id.length > 0 &&
        !isSyntheticElementId(item.id),
    );
    if (modeNativeOnly) {
      void runElementIntent({
        applyEager: () => applyPropertyIntentsEagerly(nativeIntents),
        generate: (base) =>
          intentPatch(
            generateModeScopedIntentPatch(base, nativeIntents, selectedKeyType),
          ),
      }).catch(reportElementOpError);
      return;
    }

    // plugin 포함 모드: 기존 full-record 경로 유지 (id 매칭 적용으로 개선)
    const applyGroupIntents = <T extends { id?: string }>(
      record: Record<string, T[]>,
      type: 'key' | 'stat' | 'graph' | 'knob',
    ): Record<string, T[]> => {
      const byId = nativeIntents.get(type);
      if (!byId || byId.size === 0) return record;
      return {
        ...record,
        [selectedKeyType]: (record[selectedKeyType] ?? []).map((position) => {
          const id = position.id;
          if (typeof id !== 'string') return position;
          const intent = byId.get(id);
          return intent ? { ...position, ...intent, id } : position;
        }),
      };
    };

    const updatedPositions = applyGroupIntents(
      useKeyStore.getState().canonicalPositions,
      'key',
    );
    const updatedStatPositions = applyGroupIntents(
      useStatItemStore.getState().positions,
      'stat',
    );
    const updatedGraphPositions = applyGroupIntents(
      useGraphItemStore.getState().positions,
      'graph',
    );
    const updatedKnobPositions = applyGroupIntents(
      useKnobItemStore.getState().positions,
      'knob',
    );
    useKeyStore.getState().setPositions(updatedPositions);
    useStatItemStore.getState().setPositions(updatedStatPositions);
    useGraphItemStore.getState().setPositions(updatedGraphPositions);
    useKnobItemStore.getState().setPositions(updatedKnobPositions);
    setPluginElementZIndexes(pluginZIndexUpdates);

    try {
      await editorCoordinator.commitPatch({
        schemaVersion: 1,
        keyPositions: updatedPositions,
        statPositions: updatedStatPositions,
        graphPositions: updatedGraphPositions,
        knobPositions: updatedKnobPositions,
      });
    } catch (error) {
      console.error('Failed to reorder group', error);
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // 아이템 드래그 시작
  // ──────────────────────────────────────────────────────────────────────────

  const handleMouseDown = (
    e: React.MouseEvent,
    item: LayerItem,
    _index: number,
  ) => {
    if (e.button !== 0) return;

    clearPendingDeselect();

    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();

    dragStateRef.current = {
      itemHeight: rect.height,
      currentDropTarget: null,
    };
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    isDraggingRef.current = false;

    const applyMouseMove = (moveEvent: MouseEvent) => {
      if (
        !dragStateRef.current ||
        !scrollElementRef.current ||
        !dragStartRef.current
      )
        return;

      const dx = moveEvent.clientX - dragStartRef.current.x;
      const dy = moveEvent.clientY - dragStartRef.current.y;

      if (!isDraggingRef.current) {
        if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
        isDraggingRef.current = true;
        didDragRef.current = true;

        const currentSel = useGridSelectionStore.getState().selectedElements;
        const isInSelection = currentSel.some((el) => el.id === item.id);
        if (isInSelection && currentSel.length > 1) {
          const isFullGroupSelected = (() => {
            if (!item.groupId) return false;
            const groupChildren = layerItemsRef.current.filter(
              (li) => li.groupId === item.groupId,
            );
            if (groupChildren.length === 0) return false;
            const selIds = new Set(currentSel.map((el) => el.id));
            return groupChildren.every((child) => selIds.has(child.id));
          })();
          if (isFullGroupSelected) {
            draggedItemIdsRef.current = [item.id];
          } else {
            draggedItemIdsRef.current = currentSel.map((el) => el.id);
          }
        } else {
          draggedItemIdsRef.current = [item.id];
        }

        setDraggedItemId(item.id);
        setIsDragging(true);
      }

      moveEvent.preventDefault();

      const scrollRect = scrollElementRef.current.getBoundingClientRect();
      let relativeY: number;
      if (moveEvent.clientY < scrollRect.top) {
        relativeY = -1;
      } else if (moveEvent.clientY > scrollRect.bottom) {
        relativeY =
          displayItemsRef.current.length * dragStateRef.current.itemHeight + 1;
      } else {
        relativeY =
          moveEvent.clientY -
          scrollRect.top +
          scrollElementRef.current.scrollTop;
      }
      const draggingSet = new Set(draggedItemIdsRef.current);
      const dropTarget = resolveItemDropTargetFromPointer(
        relativeY,
        dragStateRef.current.itemHeight,
        draggingSet,
      );

      let dropDisplayIndex = dropTarget.indicatorDisplayIndex;
      if (dropDisplayIndex == null && dropTarget.indicatorHeaderBottomGroupId) {
        const headerIdx = displayItemsRef.current.findIndex(
          (di) =>
            di.displayType === 'group-header' &&
            di.groupId === dropTarget.indicatorHeaderBottomGroupId,
        );
        dropDisplayIndex =
          headerIdx !== -1 ? headerIdx + 1 : dropTarget.toIndex;
      } else if (dropDisplayIndex == null) {
        dropDisplayIndex = dropTarget.toIndex;
      }
      // 드롭 위치를 숫자 index가 아니라 이웃 앵커 id로도 캡처 - mouseup까지
      // 외부 재정렬이 끼면 index는 다른 슬롯을 가리킨다 (그룹 헤더 아래는
      // 명시적 그룹 앵커로 별도 보존)
      const display = displayItemsRef.current;
      let anchorBeforeId: string | null = null;
      let anchorAfterId: string | null = null;
      let anchorBeforeHeaderGroupId: string | null = null;
      let anchorAfterHeaderGroupId: string | null = null;
      for (let i = dropDisplayIndex - 1; i >= 0; i--) {
        const di = display[i];
        if (di.displayType === 'group-header') {
          // 그룹 경계 자체를 앵커로 - 그룹 사이 빈 슬롯의 숫자 fallback 방지
          anchorBeforeHeaderGroupId = di.groupId;
          break;
        }
        if (di.displayType === 'layer' && !draggingSet.has(di.item.id)) {
          anchorBeforeId = di.item.id;
          break;
        }
      }
      for (let i = dropDisplayIndex; i < display.length; i++) {
        const di = display[i];
        if (di.displayType === 'group-header') {
          anchorAfterHeaderGroupId = di.groupId;
          break;
        }
        if (di.displayType === 'layer' && !draggingSet.has(di.item.id)) {
          anchorAfterId = di.item.id;
          break;
        }
      }
      dragStateRef.current.currentDropTarget = {
        toDisplayIndex: dropDisplayIndex,
        targetGroupId: dropTarget.targetGroupId,
        anchorBeforeId,
        anchorAfterId,
        anchorHeaderGroupId: dropTarget.indicatorHeaderBottomGroupId ?? null,
        anchorBeforeHeaderGroupId,
        anchorAfterHeaderGroupId,
      };
      setDragOverItemDisplayIndex(dropTarget.indicatorDisplayIndex);
      setDragOverHeaderBottomGroupId(dropTarget.indicatorHeaderBottomGroupId);
    };
    const moveScheduler = createRafLatestScheduler(applyMouseMove);
    const handleMouseMove = (moveEvent: MouseEvent) =>
      moveScheduler.push(moveEvent);

    const handleMouseUp = () => {
      moveScheduler.flush();
      moveScheduler.cancel();
      if (dragStateRef.current && isDraggingRef.current) {
        const target = dragStateRef.current.currentDropTarget;

        if (target) {
          const draggedIds = draggedItemIdsRef.current;
          // authoritative 재구성 목록에서 앵커를 재해석 - effect 지연 ref는
          // 외부 재정렬을 한 렌더 늦게 본다. 소실·역전·비인접이면 무커밋
          const liveModel = buildLiveLayerModel();
          const resolvedIndex = resolveDropIndexFromAnchors(
            target,
            new Set(draggedIds),
            liveModel.displayItems,
          );
          if (resolvedIndex != null) {
            performMultiDrop(draggedIds, resolvedIndex, {
              targetGroupId: target.targetGroupId,
              liveModel,
            });
          }
        }
      }

      dragStateRef.current = null;
      dragStartRef.current = null;
      isDraggingRef.current = false;
      draggedItemIdsRef.current = [];
      setDraggedItemId(null);
      setDragOverItemDisplayIndex(null);
      setDragOverHeaderBottomGroupId(null);
      setIsDragging(false);

      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // ──────────────────────────────────────────────────────────────────────────
  // 그룹 헤더 드래그 시작
  // ──────────────────────────────────────────────────────────────────────────

  const handleGroupMouseDown = (e: React.MouseEvent, groupId: string) => {
    if (e.button !== 0) return;
    clearPendingDeselect();

    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();

    groupDragStateRef.current = {
      groupId,
      itemHeight: rect.height,
      currentOverIndex: null,
      anchors: null,
      excludedIds: [],
    };
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    isDraggingRef.current = false;

    const applyMouseMove = (moveEvent: MouseEvent) => {
      if (
        !groupDragStateRef.current ||
        !scrollElementRef.current ||
        !dragStartRef.current
      )
        return;

      const dx = moveEvent.clientX - dragStartRef.current.x;
      const dy = moveEvent.clientY - dragStartRef.current.y;

      if (!isDraggingRef.current) {
        if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
        isDraggingRef.current = true;
        didDragRef.current = true;
        setDraggedGroupId(groupId);
        setIsDragging(true);
      }

      moveEvent.preventDefault();

      const scrollRect = scrollElementRef.current.getBoundingClientRect();
      const displayCount = displayItemsRef.current.length;
      let relativeY: number;
      if (moveEvent.clientY < scrollRect.top) {
        relativeY = -1;
      } else if (moveEvent.clientY > scrollRect.bottom) {
        relativeY = displayCount * groupDragStateRef.current.itemHeight + 1;
      } else {
        relativeY =
          moveEvent.clientY -
          scrollRect.top +
          scrollElementRef.current.scrollTop;
      }
      const newIndex = Math.max(
        0,
        Math.min(
          displayCount,
          Math.floor(relativeY / groupDragStateRef.current.itemHeight),
        ),
      );

      groupDragStateRef.current.currentOverIndex = newIndex;
      // 그룹 드래그도 이웃 앵커를 캡처 - 숫자 index는 mouseup까지의 외부
      // 재정렬을 모른다. 그룹이 선택된 상태면 함께 이동할 추가 선택도
      // 앵커 후보에서 제외 (이동 요소는 고정 기준점이 될 수 없다)
      const groupDraggingSet = new Set(
        layerItemsRef.current
          .filter((item) => item.groupId === groupDragStateRef.current!.groupId)
          .map((item) => item.id),
      );
      const captureSelection = useGridSelectionStore.getState();
      if (
        captureSelection.selectedGroupIds.includes(
          groupDragStateRef.current.groupId,
        )
      ) {
        for (const el of captureSelection.selectedElements) {
          groupDraggingSet.add(el.id);
        }
      }
      const groupDisplay = displayItemsRef.current;
      let groupAnchorBeforeId: string | null = null;
      let groupAnchorAfterId: string | null = null;
      let groupAnchorBeforeHeaderId: string | null = null;
      let groupAnchorAfterHeaderId: string | null = null;
      const draggedHeaderGroupId = groupDragStateRef.current.groupId;
      for (let i = newIndex - 1; i >= 0; i--) {
        const di = groupDisplay[i];
        if (di.displayType === 'group-header') {
          if (di.groupId !== draggedHeaderGroupId) {
            groupAnchorBeforeHeaderId = di.groupId;
          }
          break;
        }
        if (di.displayType === 'layer' && !groupDraggingSet.has(di.item.id)) {
          groupAnchorBeforeId = di.item.id;
          break;
        }
      }
      for (let i = newIndex; i < groupDisplay.length; i++) {
        const di = groupDisplay[i];
        if (di.displayType === 'group-header') {
          if (di.groupId !== draggedHeaderGroupId) {
            groupAnchorAfterHeaderId = di.groupId;
          }
          break;
        }
        if (di.displayType === 'layer' && !groupDraggingSet.has(di.item.id)) {
          groupAnchorAfterId = di.item.id;
          break;
        }
      }
      groupDragStateRef.current.anchors = {
        toDisplayIndex: newIndex,
        targetGroupId: undefined,
        anchorBeforeId: groupAnchorBeforeId,
        anchorAfterId: groupAnchorAfterId,
        anchorHeaderGroupId: null,
        anchorBeforeHeaderGroupId: groupAnchorBeforeHeaderId,
        anchorAfterHeaderGroupId: groupAnchorAfterHeaderId,
      };
      groupDragStateRef.current.excludedIds = [...groupDraggingSet];
      setDragOverDisplayIndex(newIndex);
    };
    const moveScheduler = createRafLatestScheduler(applyMouseMove);
    const handleMouseMove = (moveEvent: MouseEvent) =>
      moveScheduler.push(moveEvent);

    const handleMouseUp = () => {
      moveScheduler.flush();
      moveScheduler.cancel();
      if (groupDragStateRef.current && isDraggingRef.current) {
        const anchors = groupDragStateRef.current.anchors;
        // 커밋 판정 순서: live 모델 → 그룹 생존 검증 → 이동 집합 확정 →
        // 그 집합으로 앵커 해석. 앵커를 그룹 구성원만으로 먼저 풀면 함께
        // 이동하는 추가 선택이 고정 기준점으로 해석된다
        const liveModel = buildLiveLayerModel();
        const liveGroupMemberIds = new Set(
          liveModel.layerItems
            .filter((item) => item.groupId === groupId)
            .map((item) => item.id),
        );
        // 드래그 손잡이였던 그룹이 소실됐으면 무커밋 - 잔존 추가 선택만
        // 단독 이동시키지 않는다
        if (liveGroupMemberIds.size > 0) {
          const currentSel = useGridSelectionStore.getState().selectedElements;
          const currentGroupIds =
            useGridSelectionStore.getState().selectedGroupIds;
          const isGroupSelected = currentGroupIds.includes(groupId);
          const extraIds =
            isGroupSelected && currentSel.length > 0
              ? currentSel
                  .filter((el) => !liveGroupMemberIds.has(el.id))
                  .map((el) => el.id)
              : [];
          const movingIds = [...liveGroupMemberIds, ...extraIds];
          const movingSet = new Set(movingIds);
          // 캡처 때 이동 예정이라 앵커에서 제외했지만 mouseup에 이동 집합에서
          // 빠진(선택 축소) 생존 요소가 있으면 무커밋 - 앵커가 그 요소의
          // 잔류를 모르는 채 해석돼 단일 앵커 경로에서 오배치가 된다
          const liveIdSet = new Set(
            liveModel.layerItems.map((item) => item.id),
          );
          const excludedShrank = groupDragStateRef.current.excludedIds.some(
            (id) => liveIdSet.has(id) && !movingSet.has(id),
          );
          const targetIdx = excludedShrank
            ? null
            : anchors
            ? resolveDropIndexFromAnchors(
                anchors,
                movingSet,
                liveModel.displayItems,
              )
            : groupDragStateRef.current.currentOverIndex;
          if (targetIdx !== null) {
            if (extraIds.length > 0) {
              // live index를 live 모델로 재해석 - 지연 ref display로 풀면
              // 옛 이웃 기준 targetGroupId가 나온다
              const dropTarget = resolveItemDropTarget(
                targetIdx,
                movingSet,
                liveModel,
              );
              performMultiDrop(movingIds, targetIdx, {
                targetGroupId: dropTarget.targetGroupId,
                preserveFullGroups: true,
                liveModel,
              });
            } else {
              performGroupDrop(groupId, targetIdx, liveModel);
            }
          }
        }
      }

      groupDragStateRef.current = null;
      dragStartRef.current = null;
      isDraggingRef.current = false;
      setDraggedGroupId(null);
      setDragOverDisplayIndex(null);
      setIsDragging(false);

      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  return {
    // 드래그 상태 (렌더링용)
    draggedItemId,
    isDragging,
    draggedGroupId,
    dragOverItemDisplayIndex,
    dragOverHeaderBottomGroupId,
    dragOverDisplayIndex,

    // Ref 접근자 (외부 핸들러에서 참조)
    draggedItemIdsRef,
    getDidDrag: () => didDragRef.current,
    resetDidDrag: () => {
      didDragRef.current = false;
    },
    getIsDraggingRef: () => isDraggingRef.current,

    // 핸들러
    handleMouseDown,
    handleGroupMouseDown,
  };
}
