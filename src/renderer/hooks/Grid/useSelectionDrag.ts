import { useEffect, useRef, type RefObject } from 'react';
import type React from 'react';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { useSmartGuidesStore } from '@stores/grid/useSmartGuidesStore';
import { useSettingsStore } from '@stores/useSettingsStore';
import {
  calculateBounds,
  calculateGroupBounds,
  calculateSnapPoints,
  type ElementBounds,
} from '@utils/grid/smartGuides';
import { tryAcquireDragSession, releaseDragSession } from './dragSession';

interface SelectedElementLike {
  id: string;
  type?: string;
  index?: number;
}

interface UseSelectionDragOptions {
  enabled: boolean;
  zoom: number;
  startX: number;
  startY: number;
  elementId: string;
  elementWidth: number;
  elementHeight: number;
  selectedElements: SelectedElementLike[];
  getOtherElements: (excludeId: string) => ElementBounds[];
  getSelectedElementIds?: (element: SelectedElementLike) => string[];
  onMultiDragStart?: () => void | (() => void);
  onMultiDrag?: (dx: number, dy: number) => void;
  onMultiDragEnd?: () => void;
}

interface UseSelectionDragReturn {
  handlePointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  movedDuringPressRef: RefObject<boolean>;
  // 이번 press에서 실이동 발생 - 다음 pointerdown에서 리셋되므로 드래그
  // 직후 trailing click 판별 전용. 두 press를 걸치는 movedDuringPressRef를
  // 클릭 가드에 쓰면 드래그 다음번 클릭까지 삼킨다
  pressMovedRef: RefObject<boolean>;
}

// movedDuringPressRef는 "이번 또는 직전 press에서 실이동 발생"을 뜻한다 —
// dblclick은 두 press의 합성이므로 직전 press까지 봐야
// 드래그(복귀 포함) 직후의 빠른 재클릭이 편집 진입으로 새지 않는다
export const useSelectionDrag = ({
  enabled,
  zoom,
  startX,
  startY,
  elementId,
  elementWidth,
  elementHeight,
  selectedElements,
  getOtherElements,
  getSelectedElementIds = (element) => [element.id],
  onMultiDragStart,
  onMultiDrag,
  onMultiDragEnd,
}: UseSelectionDragOptions): UseSelectionDragReturn => {
  const movedDuringPressRef = useRef(false);
  const lastPressMovedRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  const activeCleanupRef = useRef<(() => void) | null>(null);

  const beginPointerDrag = (
    event: React.PointerEvent<HTMLElement> | PointerEvent,
    dragTarget: HTMLElement,
  ) => {
    if (!enabled || event.button !== 0 || activePointerIdRef.current !== null) {
      return;
    }
    // primary 포인터만 + 전역 소유권 — 다른 요소 인스턴스와의 동시 세션 차단
    if (!event.isPrimary) return;
    if (!tryAcquireDragSession()) return;

    event.stopPropagation();

    const pointerId = event.pointerId;
    const startClientX = event.clientX;
    const startClientY = event.clientY;
    const previousUserSelect = dragTarget.style.userSelect;
    const selectedIds = new Set(
      selectedElements.flatMap((element) => getSelectedElementIds(element)),
    );
    // 선택 요소는 시작 좌표를 고정 — 프레임별 최신 store 좌표에 누적 delta를
    // 다시 더하면 다중 드래그 그룹 bounds가 매 프레임 벌어짐
    const selectedStartBounds = new Map<string, ElementBounds>();
    if (selectedElements.length > 1) {
      getOtherElements(elementId).forEach((bounds) => {
        if (selectedIds.has(bounds.id)) {
          selectedStartBounds.set(bounds.id, bounds);
        }
      });
    }
    let lastSnappedDeltaX = 0;
    let lastSnappedDeltaY = 0;
    let rafId: number | null = null;
    let latestMoveEvent: PointerEvent | null = null;
    let pendingFrameCallback: (() => void) | null = null;
    let dragEnded = false;
    let actuallyDragging = false;
    let finishGesture: (() => void) | null = null;

    activePointerIdRef.current = pointerId;
    movedDuringPressRef.current = lastPressMovedRef.current;
    lastPressMovedRef.current = false;
    dragTarget.setPointerCapture(pointerId);
    dragTarget.style.userSelect = 'none';

    useSmartGuidesStore.getState().clearGuides();

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (dragEnded || moveEvent.pointerId !== activePointerIdRef.current) {
        return;
      }
      latestMoveEvent = moveEvent;
      if (rafId !== null) return;

      pendingFrameCallback = () => {
        rafId = null;
        pendingFrameCallback = null;
        const frameEvent = latestMoveEvent;
        latestMoveEvent = null;
        if (dragEnded || !frameEvent) return;

        const rawDeltaX = (frameEvent.clientX - startClientX) / zoom;
        const rawDeltaY = (frameEvent.clientY - startClientY) / zoom;
        const newX = startX + rawDeltaX;
        const newY = startY + rawDeltaY;
        const gridSettings = useSettingsStore.getState().gridSettings;
        const alignmentGuidesEnabled = gridSettings?.alignmentGuides !== false;
        const spacingGuidesEnabled = gridSettings?.spacingGuides !== false;
        const otherElements = getOtherElements(elementId);
        const nonSelectedElements = otherElements.filter(
          (element) => !selectedIds.has(element.id),
        );
        const draggedBounds = calculateBounds(
          newX,
          newY,
          elementWidth,
          elementHeight,
          elementId,
        );

        let groupBounds: ElementBounds | null = null;
        if (selectedElements.length > 1) {
          const selectedBounds = selectedElements
            .map((selectedElement) => {
              const isCurrentElement = selectedElement.id === elementId;
              if (isCurrentElement) return draggedBounds;

              const found = getSelectedElementIds(selectedElement)
                .map((id) => selectedStartBounds.get(id))
                .find(
                  (bounds): bounds is ElementBounds => bounds !== undefined,
                );
              if (!found) return null;
              return calculateBounds(
                found.left + rawDeltaX,
                found.top + rawDeltaY,
                found.width,
                found.height,
                found.id,
              );
            })
            .filter((bounds): bounds is ElementBounds => bounds !== null);
          groupBounds = calculateGroupBounds(selectedBounds);
        }

        const snapTargetBounds =
          selectedElements.length > 1 && groupBounds
            ? groupBounds
            : draggedBounds;
        const snapResult = alignmentGuidesEnabled
          ? calculateSnapPoints(
              snapTargetBounds,
              nonSelectedElements,
              undefined,
              {
                groupBounds,
                disableSpacing: !spacingGuidesEnabled,
              },
            )
          : null;

        let finalX: number;
        let finalY: number;
        if (snapResult?.didSnapX) {
          finalX =
            selectedElements.length > 1 && groupBounds
              ? newX + snapResult.snappedX - groupBounds.left
              : snapResult.snappedX;
        } else {
          const snapSize = gridSettings?.gridSnapSize || 5;
          finalX = Math.round(newX / snapSize) * snapSize;
        }
        if (snapResult?.didSnapY) {
          finalY =
            selectedElements.length > 1 && groupBounds
              ? newY + snapResult.snappedY - groupBounds.top
              : snapResult.snappedY;
        } else {
          const snapSize = gridSettings?.gridSnapSize || 5;
          finalY = Math.round(newY / snapSize) * snapSize;
        }

        const snappedDeltaX = Math.round(finalX - startX);
        const snappedDeltaY = Math.round(finalY - startY);
        const smartGuidesStore = useSmartGuidesStore.getState();
        if (snapResult && (snapResult.didSnapX || snapResult.didSnapY)) {
          const displayBounds =
            selectedElements.length > 1 && groupBounds
              ? calculateBounds(
                  groupBounds.left +
                    (snapResult.didSnapX
                      ? snapResult.snappedX - groupBounds.left
                      : 0),
                  groupBounds.top +
                    (snapResult.didSnapY
                      ? snapResult.snappedY - groupBounds.top
                      : 0),
                  groupBounds.width,
                  groupBounds.height,
                  'group',
                )
              : calculateBounds(
                  finalX,
                  finalY,
                  elementWidth,
                  elementHeight,
                  elementId,
                );
          smartGuidesStore.setDraggedBounds(displayBounds);
          smartGuidesStore.setActiveGuides(snapResult.guides);
          smartGuidesStore.setSpacingGuides(
            spacingGuidesEnabled && snapResult.spacingGuides?.length
              ? snapResult.spacingGuides
              : [],
          );
        } else {
          smartGuidesStore.clearGuides();
        }

        const moveDeltaX = snappedDeltaX - lastSnappedDeltaX;
        const moveDeltaY = snappedDeltaY - lastSnappedDeltaY;
        if (moveDeltaX !== 0 || moveDeltaY !== 0) {
          if (!actuallyDragging) {
            actuallyDragging = true;
            useGridSelectionStore.getState().setDraggingOrResizing(true);
            const cleanup = onMultiDragStart?.();
            finishGesture = typeof cleanup === 'function' ? cleanup : null;
          }
          lastSnappedDeltaX = snappedDeltaX;
          lastSnappedDeltaY = snappedDeltaY;
          movedDuringPressRef.current = true;
          lastPressMovedRef.current = true;
          onMultiDrag?.(moveDeltaX, moveDeltaY);
        }
      };
      rafId = requestAnimationFrame(pendingFrameCallback);
    };

    const finishDrag = () => {
      if (dragEnded) return;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
        const flush = pendingFrameCallback;
        pendingFrameCallback = null;
        flush?.();
      }
      dragEnded = true;
      activePointerIdRef.current = null;
      activeCleanupRef.current = null;
      releaseDragSession();

      if (dragTarget.hasPointerCapture(pointerId)) {
        dragTarget.releasePointerCapture(pointerId);
      }
      dragTarget.removeEventListener('pointermove', handlePointerMove);
      dragTarget.removeEventListener('pointerup', handlePointerEnd);
      dragTarget.removeEventListener('pointercancel', handlePointerEnd);
      dragTarget.removeEventListener('lostpointercapture', finishDrag);
      window.removeEventListener('blur', finishDrag);
      dragTarget.style.userSelect = previousUserSelect;
      useSmartGuidesStore.getState().clearGuides();
      if (actuallyDragging) {
        useGridSelectionStore.getState().setDraggingOrResizing(false);
        try {
          onMultiDragEnd?.();
        } finally {
          finishGesture?.();
          finishGesture = null;
        }
      }
    };

    const handlePointerEnd = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== activePointerIdRef.current) return;
      finishDrag();
    };

    activeCleanupRef.current = finishDrag;
    dragTarget.addEventListener('pointermove', handlePointerMove);
    dragTarget.addEventListener('pointerup', handlePointerEnd);
    dragTarget.addEventListener('pointercancel', handlePointerEnd);
    dragTarget.addEventListener('lostpointercapture', finishDrag);
    window.addEventListener('blur', finishDrag);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLElement>) => {
    beginPointerDrag(event, event.currentTarget);
  };

  useEffect(() => {
    return () => activeCleanupRef.current?.();
  }, []);

  return {
    handlePointerDown,
    movedDuringPressRef,
    pressMovedRef: lastPressMovedRef,
  };
};
