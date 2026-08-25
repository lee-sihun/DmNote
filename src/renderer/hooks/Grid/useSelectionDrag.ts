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
import { DRAG_THRESHOLD } from './constants';
import { tryAcquireDragSession, releaseDragSession } from './dragSession';
import { isMac } from '@utils/core/platform';

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

  // 소비자는 enabled와 같은 조건으로 handlePointerDown을 조건부 부착한다 -
  // 비활성화(선택 해제)되면 press가 훅을 거치지 않아 표식 소비가 끊기므로,
  // 여기서 청소하지 않으면 낡은 표식이 이후 클릭을 계속 삼킨다.
  // 드래그 도중 비활성화(Escape 선택 해제 등)면 DOM 리스너가 살아남아
  // 이후 pointermove가 표식을 재오염시키고 빈 선택에 onMultiDrag가 계속
  // 발화하므로, 진행 중 세션도 unmount와 동일 계약으로 종료한다
  // (finishDrag는 dragEnded 가드로 이중 종료에 안전)
  useEffect(() => {
    if (enabled) return;
    activeCleanupRef.current?.();
    lastPressMovedRef.current = false;
    movedDuringPressRef.current = false;
  }, [enabled]);

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
    // 개별 드래그(useDraggable)와 동일한 시작 임계값 래치 - off-grid 시작
    // 좌표에서 1px 손떨림이 스냅 점프와 클릭 흡수로 번지는 것을 차단
    let passedThreshold = false;
    let finishGesture: (() => void) | null = null;

    activePointerIdRef.current = pointerId;
    dragTarget.setPointerCapture(pointerId);
    dragTarget.style.userSelect = 'none';

    useSmartGuidesStore.getState().clearGuides();

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (dragEnded || moveEvent.pointerId !== activePointerIdRef.current) {
        return;
      }
      // 임계 판정은 개별 드래그와 동일하게 화면 px 기준, 돌파 후에는 시작
      // 좌표 기준 delta로 기존 스냅 로직을 그대로 태운다
      if (!passedThreshold) {
        const thresholdDeltaX = Math.abs(moveEvent.clientX - startClientX);
        const thresholdDeltaY = Math.abs(moveEvent.clientY - startClientY);
        if (
          thresholdDeltaX <= DRAG_THRESHOLD &&
          thresholdDeltaY <= DRAG_THRESHOLD
        ) {
          return;
        }
        passedThreshold = true;
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
        // 플랫폼 primary modifier로 스마트 스냅 일시 해제 (그리드 스냅은 유지)
        const suppressSmartSnap = isMac()
          ? frameEvent.metaKey
          : frameEvent.ctrlKey;
        const alignmentGuidesEnabled =
          gridSettings?.alignmentGuides !== false && !suppressSmartSnap;
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

        // finalX/finalY는 이미 스마트 스냅 좌표 또는 그리드 배수 - 델타를
        // 다시 정수화하면 소수 정렬 좌표가 깨져 가이드 선과 어긋난다
        const snappedDeltaX = finalX - startX;
        const snappedDeltaY = finalY - startY;
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
    // 직전 press의 실이동 표식은 이번 press가 소비한다. 드래그 세션을 못
    // 여는 press(선택 해제로 enabled=false 등)에서 남겨두면 표식이 낡은
    // 채 유지되어 이후 정상 클릭이 가드에 삼켜진다 (선택 씹힘)
    if (
      event.button === 0 &&
      event.isPrimary &&
      activePointerIdRef.current === null
    ) {
      movedDuringPressRef.current = lastPressMovedRef.current;
      lastPressMovedRef.current = false;
    }
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
