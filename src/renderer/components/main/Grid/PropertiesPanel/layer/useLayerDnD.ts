/**
 * 레이어 패널 드래그 앤 드롭 훅
 * 아이템/그룹 드래그, 드롭 타깃 계산, 순서 재배치
 */

import { isNativeElementId } from '@src/renderer/editor/model/elementId';
import {
  reportElementOpError,
  reportElementOpSkipped,
} from '@src/renderer/editor/runtime/elementIntent';
import {
  reorderLayerSelectionViaAuthority,
  type LayerReorderIntentWire,
} from '@plugins/rpc/pluginElementActions';
import { useState, useRef } from 'react';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import type { LayerItem, DisplayItem } from '../types';
import { createRafLatestScheduler } from '@utils/animation/rafLatestScheduler';
import {
  resumeCustomCursorHover,
  suspendCustomCursorHover,
} from '@utils/grid/cursorUtils';
import { commitLayerDropIntent, type DropAnchors } from './layerReorderIntent';
import { resolveLayerDropZone } from './layerDropZone';

export { resolveDropIndexFromAnchors } from './layerReorderIntent';
export { resolveLayerDropZone } from './layerDropZone';

const toReorderWire = (
  descriptor: import('./layerReorderIntent').LayerDropIntent,
): LayerReorderIntentWire => ({
  ...descriptor,
  anchors: {
    toDisplayIndex: descriptor.anchors.toDisplayIndex,
    targetGroupId: descriptor.anchors.targetGroupId ?? null,
    anchorBeforeId: descriptor.anchors.anchorBeforeId ?? null,
    anchorAfterId: descriptor.anchors.anchorAfterId ?? null,
    anchorHeaderGroupId: descriptor.anchors.anchorHeaderGroupId ?? null,
    anchorBeforeHeaderGroupId:
      descriptor.anchors.anchorBeforeHeaderGroupId ?? null,
    anchorAfterHeaderGroupId:
      descriptor.anchors.anchorAfterHeaderGroupId ?? null,
    boundary: descriptor.anchors.boundary ?? null,
  },
});

const commitLayerDropFromCurrentWindow = (
  descriptor: import('./layerReorderIntent').LayerDropIntent,
): Promise<void> => {
  if (window.__dmn_window_type !== 'panel') {
    return commitLayerDropIntent(descriptor);
  }
  return reorderLayerSelectionViaAuthority(toReorderWire(descriptor)).then(
    (succeeded) => {
      if (!succeeded) reportElementOpSkipped('panel layer drop settlement');
    },
  );
};

// 드래그 세션 동안 body에 붙는 전역 grabbing 클래스 (main.css) - 캔버스와 동일 정책
const DRAG_CURSOR_CLASS = 'dmn-dragging';

// ============================================================================
// 파라미터 타입
// ============================================================================

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
  const [dragOverIntoGroupId, setDragOverIntoGroupId] = useState<string | null>(
    null,
  );
  // 삽입 위치의 그룹 소속 - 그룹 안 삽입 인디케이터 인덴트 표시용
  const [dragOverTargetGroupId, setDragOverTargetGroupId] = useState<
    string | null
  >(null);
  const [isDragging, setIsDragging] = useState(false);
  const [draggedGroupId, setDraggedGroupId] = useState<string | null>(null);
  const [dragOverDisplayIndex, setDragOverDisplayIndex] = useState<
    number | null
  >(null);

  // Refs
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);
  const didDragRef = useRef(false);
  const didDragResetTimerRef = useRef<number | null>(null);
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
  const dragCursorAppliedRef = useRef(false);

  // press부터 세션 종료까지 전역 grabbing - WKWebView가 hover 중 CSS :active
  // 커서 갱신을 놓치는 문제로 캔버스 useDraggable과 같은 JS 토글 병행
  const applyDragCursor = () => {
    if (typeof document === 'undefined') return;
    if (dragCursorAppliedRef.current) return;
    document.body.classList.add(DRAG_CURSOR_CLASS);
    dragCursorAppliedRef.current = true;
    // 세션 동안 핸들 호버 커서 갱신 중단 (시작 시 잔여 호버 클리어 포함)
    suspendCustomCursorHover();
  };

  const clearDragCursor = () => {
    if (typeof document === 'undefined') return;
    if (!dragCursorAppliedRef.current) return;
    document.body.classList.remove(DRAG_CURSOR_CLASS);
    dragCursorAppliedRef.current = false;
    resumeCustomCursorHover();
  };

  // ──────────────────────────────────────────────────────────────────────────
  // 아이템 드롭 타깃 계산
  // ──────────────────────────────────────────────────────────────────────────

  // 표시 슬롯 → 평면 배열 삽입 index (커밋은 앵커 기준, 이 값은 fallback 보조)
  const resolveItemInsertIndex = (displaySlotIndex: number): number => {
    const items = layerItemsRef.current;
    const currentDisplay = displayItemsRef.current;
    const safeSlotIndex = Math.max(
      0,
      Math.min(currentDisplay.length, displaySlotIndex),
    );
    if (safeSlotIndex >= currentDisplay.length) return items.length;
    const targetDisplayItem = currentDisplay[safeSlotIndex];
    if (targetDisplayItem.displayType === 'layer') {
      return targetDisplayItem.flatIndex;
    }
    const firstChildIndex = items.findIndex(
      (item) => item.groupId === targetDisplayItem.groupId,
    );
    return firstChildIndex === -1 ? items.length : firstChildIndex;
  };

  // 포인터 위치 기반 드롭 타깃 계산
  const resolveItemDropTargetFromPointer = (
    relativeY: number,
    itemHeight: number,
  ) => {
    const currentDisplay = displayItemsRef.current;
    const displayCount = currentDisplay.length;

    // 목록 위아래 밖은 최상/최하 삽입 - 소속 없음
    if (displayCount === 0 || relativeY <= 0) {
      return {
        toIndex: resolveItemInsertIndex(0),
        targetGroupId: undefined,
        indicatorDisplayIndex: 0,
        intoGroupId: null,
      };
    }
    const totalHeight = displayCount * itemHeight;
    if (relativeY >= totalHeight) {
      return {
        toIndex: resolveItemInsertIndex(displayCount),
        targetGroupId: undefined,
        indicatorDisplayIndex: displayCount,
        intoGroupId: null,
      };
    }

    const rowIndex = Math.min(
      displayCount - 1,
      Math.floor(relativeY / itemHeight),
    );
    const offsetInRow = relativeY - rowIndex * itemHeight;
    const row = currentDisplay[rowIndex];
    const zone = resolveLayerDropZone(
      row.displayType === 'group-header' ? 'group-header' : 'layer',
      itemHeight,
      offsetInRow,
    );

    // 헤더 중앙 존은 그룹 진입 - 인디케이터 대신 행 전체 하이라이트
    if (row.displayType === 'group-header' && zone === 'into') {
      const firstChildIndex = layerItemsRef.current.findIndex(
        (item) => item.groupId === row.groupId,
      );
      return {
        toIndex:
          firstChildIndex === -1
            ? layerItemsRef.current.length
            : firstChildIndex,
        targetGroupId: row.groupId,
        indicatorDisplayIndex: null,
        intoGroupId: row.groupId,
      };
    }

    const displaySlotIndex = zone === 'after' ? rowIndex + 1 : rowIndex;
    // 소속은 포인터가 올라간 행 기준 - 그룹 마지막 행 아래 경계에서 위쪽
    // 행(그룹 안)과 아래쪽 행(그룹 밖)을 구분한다. 헤더 하단 가장자리는
    // 펼친 그룹이면 그룹 안 첫 위치, 접힌 그룹이면 그룹 전체 다음 바깥
    const targetGroupId =
      row.displayType === 'group-header'
        ? zone === 'after' && !row.isCollapsed
          ? row.groupId
          : undefined
        : row.item.groupId;

    return {
      toIndex: resolveItemInsertIndex(displaySlotIndex),
      targetGroupId,
      indicatorDisplayIndex: displaySlotIndex,
      intoGroupId: null,
    };
  };

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
    applyDragCursor();

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
      );

      let dropDisplayIndex = dropTarget.indicatorDisplayIndex;
      if (dropDisplayIndex == null && dropTarget.intoGroupId) {
        const headerIdx = displayItemsRef.current.findIndex(
          (di) =>
            di.displayType === 'group-header' &&
            di.groupId === dropTarget.intoGroupId,
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
        anchorHeaderGroupId: dropTarget.intoGroupId ?? null,
        anchorBeforeHeaderGroupId,
        anchorAfterHeaderGroupId,
        ...(!anchorBeforeId &&
        !anchorAfterId &&
        !anchorBeforeHeaderGroupId &&
        !anchorAfterHeaderGroupId &&
        !dropTarget.intoGroupId
          ? {
              boundary:
                dropDisplayIndex <= 0 ? ('top' as const) : ('bottom' as const),
            }
          : {}),
      };
      setDragOverItemDisplayIndex(dropTarget.indicatorDisplayIndex);
      setDragOverIntoGroupId(dropTarget.intoGroupId);
      setDragOverTargetGroupId(dropTarget.targetGroupId ?? null);
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
          const hasInvalidNative = liveModel.layerItems.some(
            (item) => item.type !== 'plugin' && !isNativeElementId(item.id),
          );
          if (!hasInvalidNative) {
            void commitLayerDropFromCurrentWindow({
              kind: 'items',
              mode: selectedKeyType,
              draggedIds: [...draggedIds],
              anchors: target,
              preserveFullGroups: false,
              collapsedGroupIds: [
                ...useLayerGroupStore.getState().collapsedGroups,
              ],
            }).catch(reportElementOpError);
          } else {
            reportElementOpSkipped('layer drop (invalid native id)');
          }
        }
      }

      clearDragCursor();
      dragStateRef.current = null;
      dragStartRef.current = null;
      isDraggingRef.current = false;
      draggedItemIdsRef.current = [];
      setDraggedItemId(null);
      setDragOverItemDisplayIndex(null);
      setDragOverIntoGroupId(null);
      setDragOverTargetGroupId(null);
      setIsDragging(false);

      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);

      // 드래그 표식은 trailing click 한 번만 흡수한다. mousedown 행과 mouseup
      // 행이 다르면 행 onClick이 발화하지 않아 소비자가 리셋할 기회가 없고,
      // 그 뒤 아무 행이나 클릭하면 그 클릭이 대신 삼켜진다.
      // trailing click은 mouseup과 같은 시퀀스라 한 태스크 뒤에 리셋한다
      // (useDraggable의 보류 청소와 동일 계약)
      if (didDragRef.current) {
        if (didDragResetTimerRef.current !== null) {
          window.clearTimeout(didDragResetTimerRef.current);
        }
        didDragResetTimerRef.current = window.setTimeout(() => {
          didDragResetTimerRef.current = null;
          // 새 드래그가 시작됐으면 그 세션의 종료가 다시 스케줄한다
          if (isDraggingRef.current) return;
          didDragRef.current = false;
        }, 0);
      }
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
    applyDragCursor();

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
        ...(!groupAnchorBeforeId &&
        !groupAnchorAfterId &&
        !groupAnchorBeforeHeaderId &&
        !groupAnchorAfterHeaderId
          ? {
              boundary: newIndex <= 0 ? ('top' as const) : ('bottom' as const),
            }
          : {}),
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
          const hasInvalidNative = liveModel.layerItems.some(
            (item) => item.type !== 'plugin' && !isNativeElementId(item.id),
          );
          if (!excludedShrank && anchors && !hasInvalidNative) {
            void commitLayerDropFromCurrentWindow({
              kind: 'group',
              mode: selectedKeyType,
              groupId,
              extraIds,
              anchors,
              collapsedGroupIds: [
                ...useLayerGroupStore.getState().collapsedGroups,
              ],
            }).catch(reportElementOpError);
          } else if (hasInvalidNative) {
            reportElementOpSkipped('group drop (invalid native id)');
          }
        }
      }

      clearDragCursor();
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
    dragOverIntoGroupId,
    dragOverTargetGroupId,
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
