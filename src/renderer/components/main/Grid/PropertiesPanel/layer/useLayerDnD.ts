/**
 * 레이어 패널 드래그 앤 드롭 훅
 * 아이템/그룹 드래그, 드롭 타깃 계산, 순서 재배치
 */

import { useState, useRef } from 'react';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { useHistoryStore } from '@stores/data/useHistoryStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { normalizeLayerGroupsForMode } from '@utils/layerGroupUtils';
import type { LayerItem, DisplayItem } from '../types';

// ============================================================================
// 파라미터 타입
// ============================================================================

interface UseLayerDnDParams {
  selectedKeyType: string;
  layerItemsRef: React.MutableRefObject<LayerItem[]>;
  displayItemsRef: React.MutableRefObject<DisplayItem[]>;
  scrollElementRef: React.MutableRefObject<HTMLDivElement | null>;
  clearPendingDeselect: () => void;
}

// ============================================================================
// 오버레이 동기화 헬퍼
// ============================================================================

function syncOverlayPositions(
  keyPositions: ReturnType<typeof useKeyStore.getState>['positions'],
  statPositions: ReturnType<typeof useStatItemStore.getState>['positions'],
  graphPositions: ReturnType<typeof useGraphItemStore.getState>['positions'],
  knobPositions: ReturnType<typeof useKnobItemStore.getState>['positions'],
) {
  try {
    window.api.bridge.sendTo('overlay', 'positions:sync', {
      positions: keyPositions,
    });
  } catch {
    // ignore
  }
  try {
    window.api.bridge.sendTo('overlay', 'statPositions:sync', {
      positions: statPositions,
    });
  } catch {
    // ignore
  }
  try {
    window.api.bridge.sendTo('overlay', 'graphPositions:sync', {
      positions: graphPositions,
    });
  } catch {
    // ignore
  }
  try {
    window.api.bridge.sendTo('overlay', 'knobPositions:sync', {
      positions: knobPositions,
    });
  } catch {
    // ignore
  }
  try {
    const pluginEls = usePluginDisplayElementStore.getState().elements;
    window.api.bridge.sendTo('overlay', 'plugin:displayElements:sync', {
      elements: pluginEls,
    });
  } catch {
    // ignore
  }
}

// ============================================================================
// 훅
// ============================================================================

export function useLayerDnD({
  selectedKeyType,
  layerItemsRef,
  displayItemsRef,
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
    currentDropTarget: {
      toDisplayIndex: number;
      targetGroupId: string | undefined;
    } | null;
  } | null>(null);
  const draggedItemIdsRef = useRef<string[]>([]);
  const groupDragStateRef = useRef<{
    groupId: string;
    itemHeight: number;
    currentOverIndex: number | null;
  } | null>(null);

  // ──────────────────────────────────────────────────────────────────────────
  // 아이템 드롭 타깃 계산
  // ──────────────────────────────────────────────────────────────────────────

  const resolveItemDropTarget = (
    displaySlotIndex: number,
    draggingItemIds: ReadonlySet<string>,
  ) => {
    const items = layerItemsRef.current;
    const currentDisplay = displayItemsRef.current;
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

  const performMultiDrop = async (
    draggedIds: string[],
    toDisplayIndex: number,
    dropContext?: {
      targetGroupId: string | undefined;
      preserveFullGroups?: boolean;
    },
  ) => {
    const items = [...layerItemsRef.current];
    const currentDisplay = displayItemsRef.current;
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

    // 히스토리 저장
    const currentPositions = useKeyStore.getState().positions;
    const currentStatPositions = useStatItemStore.getState().positions;
    const currentGraphPositions = useGraphItemStore.getState().positions;
    const currentKnobPositions = useKnobItemStore.getState().positions;
    const currentPluginElements =
      usePluginDisplayElementStore.getState().elements;
    const currentLayerGroups = useLayerGroupStore.getState().layerGroups;
    const { keyMappings: km } = useKeyStore.getState();
    useHistoryStore.getState().pushState({
      keyMappings: km,
      positions: currentPositions,
      statPositions: currentStatPositions,
      graphPositions: currentGraphPositions,
      pluginElements: currentPluginElements,
      layerGroups: currentLayerGroups,
    });

    // z-index 재계산 및 적용
    const maxZIndex = newItems.length - 1;

    const updatedPositions = { ...currentPositions };
    const currentModePositions = [...(updatedPositions[selectedKeyType] || [])];
    const updatedStatPositions = { ...currentStatPositions };
    const currentStatModePositions = [
      ...(updatedStatPositions[selectedKeyType] || []),
    ];
    const updatedGraphPositions = { ...currentGraphPositions };
    const currentGraphModePositions = [
      ...(updatedGraphPositions[selectedKeyType] || []),
    ];
    const updatedKnobPositions = { ...currentKnobPositions };
    const currentKnobModePositions = [
      ...(updatedKnobPositions[selectedKeyType] || []),
    ];

    newItems.forEach((item, idx) => {
      const newZIndex = maxZIndex - idx;
      const isDraggedItem = draggedIdSet.has(item.id);

      if (item.type === 'key' && item.index !== undefined) {
        if (currentModePositions[item.index]) {
          currentModePositions[item.index] = {
            ...currentModePositions[item.index],
            zIndex: newZIndex,
            ...(isDraggedItem && !preserveGroupIds.has(item.id)
              ? { groupId: newGroupId }
              : {}),
          };
        }
      } else if (item.type === 'stat' && item.index !== undefined) {
        if (currentStatModePositions[item.index]) {
          currentStatModePositions[item.index] = {
            ...currentStatModePositions[item.index],
            zIndex: newZIndex,
            ...(isDraggedItem && !preserveGroupIds.has(item.id)
              ? { groupId: newGroupId }
              : {}),
          };
        }
      } else if (item.type === 'graph' && item.index !== undefined) {
        if (currentGraphModePositions[item.index]) {
          currentGraphModePositions[item.index] = {
            ...currentGraphModePositions[item.index],
            zIndex: newZIndex,
            ...(isDraggedItem && !preserveGroupIds.has(item.id)
              ? { groupId: newGroupId }
              : {}),
          };
        }
      } else if (item.type === 'knob' && item.index !== undefined) {
        if (currentKnobModePositions[item.index]) {
          currentKnobModePositions[item.index] = {
            ...currentKnobModePositions[item.index],
            zIndex: newZIndex,
            ...(isDraggedItem && !preserveGroupIds.has(item.id)
              ? { groupId: newGroupId }
              : {}),
          };
        }
      } else if (item.type === 'plugin') {
        usePluginDisplayElementStore.getState().updateElement(item.id, {
          zIndex: newZIndex,
        });
      }
    });

    updatedPositions[selectedKeyType] = currentModePositions;
    updatedStatPositions[selectedKeyType] = currentStatModePositions;
    updatedGraphPositions[selectedKeyType] = currentGraphModePositions;
    updatedKnobPositions[selectedKeyType] = currentKnobModePositions;

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
    if (normalized.groupsChanged) {
      useLayerGroupStore.getState().setLayerGroups(normalized.layerGroups);
    }

    // 백엔드/오버레이 동기화
    useKeyStore.getState().setLocalUpdateInProgress(true);
    useStatItemStore.getState().setLocalUpdateInProgress(true);
    useGraphItemStore.getState().setLocalUpdateInProgress(true);
    useKnobItemStore.getState().setLocalUpdateInProgress(true);
    try {
      await window.api.keys.updatePositions(normalized.keyPositions);
      await window.api.statItems.updatePositions(normalized.statPositions);
      await window.api.graphItems.updatePositions(normalized.graphPositions);
      await window.api.knobItems.updatePositions(normalized.knobPositions);
      if (normalized.groupsChanged) {
        await window.api.layerGroups.update(normalized.layerGroups);
      }
    } catch (error) {
      console.error('Failed to reorder layers', error);
    } finally {
      useKeyStore.getState().setLocalUpdateInProgress(false);
      useStatItemStore.getState().setLocalUpdateInProgress(false);
      useGraphItemStore.getState().setLocalUpdateInProgress(false);
      useKnobItemStore.getState().setLocalUpdateInProgress(false);
    }

    syncOverlayPositions(
      normalized.keyPositions,
      normalized.statPositions,
      normalized.graphPositions,
      normalized.knobPositions,
    );
  };

  // ──────────────────────────────────────────────────────────────────────────
  // 그룹 드롭 처리
  // ──────────────────────────────────────────────────────────────────────────

  const performGroupDrop = async (
    groupId: string,
    targetDisplayIndex: number,
  ) => {
    const items = [...layerItemsRef.current];
    const currentDisplay = displayItemsRef.current;

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

    // 히스토리 저장
    const currentPositions = useKeyStore.getState().positions;
    const currentStatPositions = useStatItemStore.getState().positions;
    const currentGraphPositions = useGraphItemStore.getState().positions;
    const currentPluginElements =
      usePluginDisplayElementStore.getState().elements;
    const currentLayerGroups = useLayerGroupStore.getState().layerGroups;
    const { keyMappings: km } = useKeyStore.getState();
    useHistoryStore.getState().pushState({
      keyMappings: km,
      positions: currentPositions,
      statPositions: currentStatPositions,
      graphPositions: currentGraphPositions,
      pluginElements: currentPluginElements,
      layerGroups: currentLayerGroups,
    });

    // z-index 재계산
    const maxZIndex = newItems.length - 1;

    const updatedPositions = { ...useKeyStore.getState().positions };
    const currentModePositions = [...(updatedPositions[selectedKeyType] || [])];
    const updatedStatPositions = {
      ...useStatItemStore.getState().positions,
    };
    const currentStatModePositions = [
      ...(updatedStatPositions[selectedKeyType] || []),
    ];
    const updatedGraphPositions = {
      ...useGraphItemStore.getState().positions,
    };
    const currentGraphModePositions = [
      ...(updatedGraphPositions[selectedKeyType] || []),
    ];
    const updatedKnobPositions = {
      ...useKnobItemStore.getState().positions,
    };
    const currentKnobModePositions = [
      ...(updatedKnobPositions[selectedKeyType] || []),
    ];

    newItems.forEach((item, idx) => {
      const newZIndex = maxZIndex - idx;
      if (item.type === 'key' && item.index !== undefined) {
        if (currentModePositions[item.index]) {
          currentModePositions[item.index] = {
            ...currentModePositions[item.index],
            zIndex: newZIndex,
          };
        }
      } else if (item.type === 'stat' && item.index !== undefined) {
        if (currentStatModePositions[item.index]) {
          currentStatModePositions[item.index] = {
            ...currentStatModePositions[item.index],
            zIndex: newZIndex,
          };
        }
      } else if (item.type === 'graph' && item.index !== undefined) {
        if (currentGraphModePositions[item.index]) {
          currentGraphModePositions[item.index] = {
            ...currentGraphModePositions[item.index],
            zIndex: newZIndex,
          };
        }
      } else if (item.type === 'knob' && item.index !== undefined) {
        if (currentKnobModePositions[item.index]) {
          currentKnobModePositions[item.index] = {
            ...currentKnobModePositions[item.index],
            zIndex: newZIndex,
          };
        }
      } else if (item.type === 'plugin') {
        usePluginDisplayElementStore.getState().updateElement(item.id, {
          zIndex: newZIndex,
        });
      }
    });

    updatedPositions[selectedKeyType] = currentModePositions;
    useKeyStore.getState().setPositions(updatedPositions);
    updatedStatPositions[selectedKeyType] = currentStatModePositions;
    useStatItemStore.getState().setPositions(updatedStatPositions);
    updatedGraphPositions[selectedKeyType] = currentGraphModePositions;
    useGraphItemStore.getState().setPositions(updatedGraphPositions);
    updatedKnobPositions[selectedKeyType] = currentKnobModePositions;
    useKnobItemStore.getState().setPositions(updatedKnobPositions);

    // 백엔드 동기화
    useKeyStore.getState().setLocalUpdateInProgress(true);
    useStatItemStore.getState().setLocalUpdateInProgress(true);
    useGraphItemStore.getState().setLocalUpdateInProgress(true);
    useKnobItemStore.getState().setLocalUpdateInProgress(true);
    try {
      await window.api.keys.updatePositions(updatedPositions);
      await window.api.statItems.updatePositions(updatedStatPositions);
      await window.api.graphItems.updatePositions(updatedGraphPositions);
      await window.api.knobItems.updatePositions(updatedKnobPositions);
    } catch (error) {
      console.error('Failed to reorder group', error);
    } finally {
      useKeyStore.getState().setLocalUpdateInProgress(false);
      useStatItemStore.getState().setLocalUpdateInProgress(false);
      useGraphItemStore.getState().setLocalUpdateInProgress(false);
      useKnobItemStore.getState().setLocalUpdateInProgress(false);
    }

    syncOverlayPositions(
      updatedPositions,
      updatedStatPositions,
      updatedGraphPositions,
      updatedKnobPositions,
    );
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

    const handleMouseMove = (moveEvent: MouseEvent) => {
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
      dragStateRef.current.currentDropTarget = {
        toDisplayIndex: dropDisplayIndex,
        targetGroupId: dropTarget.targetGroupId,
      };
      setDragOverItemDisplayIndex(dropTarget.indicatorDisplayIndex);
      setDragOverHeaderBottomGroupId(dropTarget.indicatorHeaderBottomGroupId);
    };

    const handleMouseUp = () => {
      if (dragStateRef.current && isDraggingRef.current) {
        const target = dragStateRef.current.currentDropTarget;

        if (target) {
          const draggedIds = draggedItemIdsRef.current;
          performMultiDrop(draggedIds, target.toDisplayIndex, {
            targetGroupId: target.targetGroupId,
          });
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
    };
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    isDraggingRef.current = false;

    const handleMouseMove = (moveEvent: MouseEvent) => {
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
      setDragOverDisplayIndex(newIndex);
    };

    const handleMouseUp = () => {
      if (groupDragStateRef.current && isDraggingRef.current) {
        const targetIdx = groupDragStateRef.current.currentOverIndex;
        if (targetIdx !== null) {
          const currentSel = useGridSelectionStore.getState().selectedElements;
          const currentGroupIds =
            useGridSelectionStore.getState().selectedGroupIds;
          const isGroupSelected = currentGroupIds.includes(groupId);

          if (isGroupSelected && currentSel.length > 0) {
            const groupChildIds = new Set(
              layerItemsRef.current
                .filter((item) => item.groupId === groupId)
                .map((c) => c.id),
            );
            const hasExtraSelection = currentSel.some(
              (el) => !groupChildIds.has(el.id),
            );

            if (hasExtraSelection) {
              const allIds = [
                ...layerItemsRef.current
                  .filter((item) => item.groupId === groupId)
                  .map((c) => c.id),
                ...currentSel
                  .filter((el) => !groupChildIds.has(el.id))
                  .map((el) => el.id),
              ];
              const dropTarget = resolveItemDropTarget(
                targetIdx,
                new Set(allIds),
              );
              performMultiDrop(allIds, targetIdx, {
                targetGroupId: dropTarget.targetGroupId,
                preserveFullGroups: true,
              });
            } else {
              performGroupDrop(groupId, targetIdx);
            }
          } else {
            performGroupDrop(groupId, targetIdx);
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
