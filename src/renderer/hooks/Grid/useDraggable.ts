import { useState, useEffect, useRef, type RefObject } from 'react';
import {
  MIN_GRID_POSITION,
  MAX_GRID_POSITION,
} from '@stores/grid/useGridViewStore';
import { useSmartGuidesStore } from '@stores/grid/useSmartGuidesStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { useSettingsStore } from '@stores/useSettingsStore';
import { calculateBounds, calculateSnapPoints } from '@utils/grid/smartGuides';
import {
  resumeCustomCursorHover,
  suspendCustomCursorHover,
} from '@utils/grid/cursorUtils';
import { DRAG_THRESHOLD } from './constants';
import { tryAcquireDragSession, releaseDragSession } from './dragSession';

interface ElementBounds {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

interface UseDraggableOptions {
  gridSize?: number;
  initialX?: number;
  initialY?: number;
  onPositionChange?: (x: number, y: number) => void;
  onDragStart?: () => void | (() => void);
  zoom?: number;
  panX?: number;
  panY?: number;
  elementId: string;
  elementWidth?: number;
  elementHeight?: number;
  getOtherElements?: ((excludeId: string) => ElementBounds[]) | null;
  disabled?: boolean;
}

interface UseDraggableReturn {
  ref: (node: HTMLElement | null) => void;
  dx: number;
  dy: number;
  wasMoved: boolean;
  isDragging: boolean;
  /** 이번 또는 직전 press에서 실이동 발생 — dblclick 편집 진입 가드용 */
  recentPressMovedRef: RefObject<boolean>;
}

// 드래그 세션 동안 body에 붙는 전역 grabbing 클래스 (main.css)
const DRAG_CURSOR_CLASS = 'dmn-dragging';

// 위치 클램핑 함수
const clampPosition = (value: number): number => {
  return Math.min(Math.max(value, MIN_GRID_POSITION), MAX_GRID_POSITION);
};

// 줌 레벨에 따른 동적 그리드 스냅 크기 계산
// 화면상 일정한 드래그 거리를 유지하면서 최소 1px 보장
const MIN_GRID_SIZE = 1;

const calculateDynamicGridSize = (
  zoom: number,
  baseGridSize: number,
): number => {
  const dynamicSize = Math.round(baseGridSize / zoom);
  return Math.max(dynamicSize, MIN_GRID_SIZE);
};

export const useDraggable = ({
  gridSize: _gridSize, // 기본 그리드 크기 (사용하지 않음, 동적 계산으로 대체)
  initialX = 0,
  initialY = 0,
  onPositionChange,
  onDragStart = undefined, // 드래그 시작 시 호출되는 콜백 (히스토리 저장용, 선택적)
  zoom = 1, // 줌 레벨 (기본값 1)
  panX = 0, // 팬 X 오프셋
  panY = 0, // 팬 Y 오프셋
  // 스마트 가이드 관련 옵션
  elementId, // 요소 식별자
  elementWidth = 60, // 요소 너비
  elementHeight = 60, // 요소 높이
  getOtherElements = null, // 다른 요소들의 bounds를 반환하는 함수
  disabled = false, // 드래그 비활성화 옵션
}: UseDraggableOptions): UseDraggableReturn => {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [wasMoved, setWasMoved] = useState<boolean>(false);
  const [{ dx, dy }, setOffset] = useState<{ dx: number; dy: number }>({
    dx: initialX,
    dy: initialY,
  });

  // 마지막 스냅 좌표를 ref로 보관 (mouseup 시 커밋)
  const lastSnappedRef = useRef<{ dx: number; dy: number }>({
    dx: initialX,
    dy: initialY,
  });
  // 드래그 감지를 위한 최소 거리 임계값
  const dragThresholdRef = useRef<number>(DRAG_THRESHOLD);

  // 줌/팬 값을 ref로 저장 (드래그 중 최신 값 참조)
  const zoomRef = useRef<number>(zoom);
  const panXRef = useRef<number>(panX);
  const panYRef = useRef<number>(panY);

  // 스마트 가이드 관련 ref
  const elementIdRef = useRef<string>(elementId);
  const elementWidthRef = useRef<number>(elementWidth);
  const elementHeightRef = useRef<number>(elementHeight);
  const getOtherElementsRef = useRef<
    ((excludeId: string) => ElementBounds[]) | null
  >(getOtherElements);
  const disabledRef = useRef<boolean>(disabled);
  // 이 인스턴스가 붙인 body 클래스만 제거 (다른 세션의 클래스 오제거 방지)
  const dragCursorAppliedRef = useRef(false);
  // 진행 중 드래그 세션 존재 여부 — 트랙패드 이중 press가 세션을 겹쳐 시작하면
  // 먼저 끝난 세션의 정리 코드가 커서·리스너를 지워 남은 세션이 오염됨
  const activeDragRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  const activeDragCleanupRef = useRef<(() => void) | null>(null);
  // dblclick은 두 press의 합성 — 직전 press의 이동까지 기억해야
  // 드래그(제자리 복귀 포함) 직후의 빠른 재클릭이 편집 진입으로 새지 않음
  const movedThisPressRef = useRef(false);
  const recentPressMovedRef = useRef(false);
  // 드래그 중 도착한 외부 initial 동기화의 유예 버퍼 (세션 종료 시 정산)
  const pendingInitialSyncRef = useRef<{ dx: number; dy: number } | null>(null);
  // 드래그 세션 중 disabled 전이가 오면 표식 청소를 세션 종료 후로 보류
  const pendingDisabledResetRef = useRef(false);
  const disabledResetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    zoomRef.current = zoom;
    panXRef.current = panX;
    panYRef.current = panY;
  }, [zoom, panX, panY]);

  useEffect(() => {
    elementIdRef.current = elementId;
    elementWidthRef.current = elementWidth;
    elementHeightRef.current = elementHeight;
    getOtherElementsRef.current = getOtherElements;
    disabledRef.current = disabled;
  }, [elementId, elementWidth, elementHeight, getOtherElements, disabled]);

  // press 없이 선택에 편입(마퀴·레이어 탭)되어 disabled가 되면 표식을
  // 리셋할 pointerdown 경로가 끊긴다 - 낡은 표식이 수식키 클릭·더블클릭을
  // 계속 삼키지 않게 여기서 청소 (useSelectionDrag의 enabled 청소와 대칭).
  // 드래그 세션 중이면 즉시 지우지 않고 세션 종료 후로 보류 - 릴리즈
  // trailing click까지는 가드가 살아 있어야 실드래그 직후 클릭이 새지 않는다
  useEffect(() => {
    if (!disabled) {
      // 보류 취소 - 재활성화 후에는 다음 pointerdown이 어차피 리셋한다
      pendingDisabledResetRef.current = false;
      return;
    }
    if (activeDragRef.current) {
      pendingDisabledResetRef.current = true;
      return;
    }
    setWasMoved(false);
    movedThisPressRef.current = false;
    recentPressMovedRef.current = false;
  }, [disabled]);

  // initialX, initialY 변경 시 동기화
  useEffect(() => {
    // 드래그 중 외부 store 변경이 시작 좌표를 오염시키면 릴리즈 시 옛 값이
    // 커밋된다 - 세션이 끝날 때까지 유예
    if (activeDragRef.current) {
      pendingInitialSyncRef.current = { dx: initialX, dy: initialY };
      return;
    }
    pendingInitialSyncRef.current = null;
    setOffset({ dx: initialX, dy: initialY });
    lastSnappedRef.current = { dx: initialX, dy: initialY };
  }, [initialX, initialY]);

  const ref = (nodeEle: HTMLElement | null) => {
    setNode(nodeEle);
  };

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

  const handlePointerDown = (e: PointerEvent) => {
    if (!node) return;
    const dragTarget = e.currentTarget as HTMLElement;

    // 좌클릭만 처리 (미들 버튼은 그리드 팬에 사용)
    if (e.button !== 0) return;

    // primary 포인터만 — 터치의 두 번째 손가락 등 비주 포인터는 드래그 시작 금지
    if (!e.isPrimary) return;

    // disabled 상태면 드래그 무시
    if (disabledRef.current) return;

    // 미들 버튼 드래그 중이면 요소 드래그 무시 (그리드 팬 우선)
    if (useGridSelectionStore.getState().isMiddleButtonDragging) return;

    // 세션 재진입 가드 — 드래그 중 추가 press(트랙패드 이중 탭 등)는 무시.
    // 전역 소유권까지 획득해야 다른 요소 인스턴스와의 동시 세션도 차단됨
    if (activeDragRef.current) return;
    if (!tryAcquireDragSession()) return;
    activeDragRef.current = true;
    activePointerIdRef.current = e.pointerId;
    dragTarget.setPointerCapture(e.pointerId);

    // 드래그 시작 전 기존 스마트 가이드 클리어 (이전 드래그가 정상 종료되지 않은 경우 대비)
    useSmartGuidesStore.getState().clearGuides();

    // 마우스 다운 시점의 위치 저장
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    let actuallyDragging = false;

    setIsDragging(true);
    setWasMoved(false);
    recentPressMovedRef.current = movedThisPressRef.current;
    movedThisPressRef.current = false;

    // press부터 세션 종료까지 body 클래스로 전역 grabbing (호버 커서 변경 없음)
    // WKWebView가 hover 중 CSS :active 커서 갱신을 놓치는 문제로 JS 토글 병행
    applyDragCursor();

    // 현재 줌/팬 값 캡처
    const currentZoom = zoomRef.current;

    // gridSettings에서 스냅 크기 가져오기
    const gridSnapSize =
      useSettingsStore.getState().gridSettings?.gridSnapSize || 5;

    // 줌 레벨에 따른 동적 그리드 크기 계산
    const dynamicGridSize = calculateDynamicGridSize(currentZoom, gridSnapSize);

    // 무한 캔버스에서는 경계 제한 없음
    // 시작 위치 계산 (줌 반영)
    const startPos = {
      x: e.clientX - dx * currentZoom,
      y: e.clientY - dy * currentZoom,
    };
    const initialPosition = { dx, dy };

    let rafId: number | null = null;
    let latestMoveEvent: PointerEvent | null = null;
    let pendingFrameCallback: (() => void) | null = null;
    let finishGesture: (() => void) | null = null;
    // 드래그 종료 플래그 (rAF 콜백에서 체크)
    let dragEnded = false;
    // Shift 키 드래그 시 축 고정을 위한 변수
    let lockedAxis: 'x' | 'y' | null = null;

    // 스마트 가이드 스토어 참조
    const smartGuidesStore = useSmartGuidesStore.getState();

    const handlePointerMove = (moveEvent: PointerEvent) => {
      // 드래그가 종료되었으면 무시
      if (dragEnded || moveEvent.pointerId !== activePointerIdRef.current)
        return;

      // 드래그 임계값 체크
      const deltaX = Math.abs(moveEvent.clientX - startClientX);
      const deltaY = Math.abs(moveEvent.clientY - startClientY);

      if (
        !actuallyDragging &&
        (deltaX > dragThresholdRef.current || deltaY > dragThresholdRef.current)
      ) {
        actuallyDragging = true;
        // 실제 드래그가 시작될 때만 최적화 적용
        dragTarget.style.userSelect = 'none';
        // 드래그 시작 시 애니메이션 비활성화
        useGridSelectionStore.getState().setDraggingOrResizing(true);
        // 드래그 시작 콜백 호출 (히스토리 저장용)
        const cleanup = onDragStart?.();
        finishGesture = typeof cleanup === 'function' ? cleanup : null;

        // Shift 키가 눌려있으면 처음 움직인 방향으로 축 고정
        if (moveEvent.shiftKey && lockedAxis === null) {
          lockedAxis = deltaX >= deltaY ? 'x' : 'y';
        }
      }

      if (!actuallyDragging) return;

      latestMoveEvent = moveEvent;
      if (rafId) return;
      pendingFrameCallback = () => {
        rafId = null;
        pendingFrameCallback = null;
        const frameEvent = latestMoveEvent;
        latestMoveEvent = null;

        // 드래그가 종료되었으면 rAF 콜백에서도 무시
        if (dragEnded || !frameEvent) return;

        // 줌 레벨을 고려한 좌표 계산
        let newDx = (frameEvent.clientX - startPos.x) / currentZoom;
        let newDy = (frameEvent.clientY - startPos.y) / currentZoom;

        // Shift 키로 축이 고정된 경우 해당 축만 이동
        if (lockedAxis === 'x') {
          newDy = initialPosition.dy;
        } else if (lockedAxis === 'y') {
          newDx = initialPosition.dx;
        }

        // 스마트 가이드 계산 (getOtherElements가 제공된 경우)
        const getOtherElementsFn = getOtherElementsRef.current;
        const currentElementId = elementIdRef.current;
        const currentWidth = elementWidthRef.current;
        const currentHeight = elementHeightRef.current;

        let finalX = newDx;
        let finalY = newDy;
        let didSmartSnapX = false;
        let didSmartSnapY = false;

        // gridSettings에서 정렬 가이드 활성화 여부 확인
        const gridSettings = useSettingsStore.getState().gridSettings;
        const alignmentGuidesEnabled = gridSettings?.alignmentGuides !== false;
        const spacingGuidesEnabled = gridSettings?.spacingGuides !== false;

        if (getOtherElementsFn && currentElementId && alignmentGuidesEnabled) {
          const otherElements = getOtherElementsFn(currentElementId);
          const draggedBounds = calculateBounds(
            newDx,
            newDy,
            currentWidth,
            currentHeight,
            currentElementId,
          );

          const snapResult = calculateSnapPoints(
            draggedBounds,
            otherElements,
            undefined,
            { disableSpacing: !spacingGuidesEnabled },
          );

          if (snapResult.didSnapX || snapResult.didSnapY) {
            // 스마트 가이드 스냅이 적용됨 (축별로 개별 처리)
            // 간격 스냅이 비활성화된 경우 간격 스냅 무시
            if (snapResult.didSnapX) {
              // 간격 스냅인 경우 spacingGuidesEnabled 확인
              if (snapResult.didSpacingSnapX && !spacingGuidesEnabled) {
                // 간격 스냅 무시, 정렬 스냅만 사용
                // didSnapX가 true이지만 didSpacingSnapX만 true인 경우는 무시
              } else {
                finalX = snapResult.snappedX;
                didSmartSnapX = true;
              }
            }
            if (snapResult.didSnapY) {
              if (snapResult.didSpacingSnapY && !spacingGuidesEnabled) {
                // 간격 스냅 무시
              } else {
                finalY = snapResult.snappedY;
                didSmartSnapY = true;
              }
            }

            // 스냅된 bounds 업데이트
            const snappedBounds = calculateBounds(
              finalX,
              finalY,
              currentWidth,
              currentHeight,
              currentElementId,
            );
            smartGuidesStore.setDraggedBounds(snappedBounds);
            smartGuidesStore.setActiveGuides(snapResult.guides);

            // 간격 가이드도 업데이트 (spacingGuidesEnabled가 true인 경우에만)
            if (
              spacingGuidesEnabled &&
              snapResult.spacingGuides &&
              snapResult.spacingGuides.length > 0
            ) {
              smartGuidesStore.setSpacingGuides(snapResult.spacingGuides);
            } else {
              smartGuidesStore.setSpacingGuides([]);
            }
          } else {
            // 스마트 가이드 스냅이 없으면 가이드라인 클리어
            smartGuidesStore.clearGuides();
          }
        }

        // 축별로 스냅 적용
        // X축: 스마트 가이드로 스냅되지 않은 경우에만 기본 그리드 스냅 적용
        let snappedX: number;
        if (didSmartSnapX) {
          snappedX = clampPosition(Math.round(finalX));
        } else {
          snappedX = clampPosition(
            Math.round(finalX / dynamicGridSize) * dynamicGridSize,
          );
        }

        // Y축: 스마트 가이드로 스냅되지 않은 경우에만 기본 그리드 스냅 적용
        let snappedY: number;
        if (didSmartSnapY) {
          snappedY = clampPosition(Math.round(finalY));
        } else {
          snappedY = clampPosition(
            Math.round(finalY / dynamicGridSize) * dynamicGridSize,
          );
        }

        if (
          snappedX !== initialPosition.dx ||
          snappedY !== initialPosition.dy
        ) {
          setWasMoved(true);
          movedThisPressRef.current = true;
          recentPressMovedRef.current = true;
        }

        lastSnappedRef.current = { dx: snappedX, dy: snappedY };
        setOffset({ dx: snappedX, dy: snappedY });
      };
      rafId = requestAnimationFrame(pendingFrameCallback);
    };

    const finishDrag = () => {
      if (dragEnded) return;

      // 마지막 프레임 대기 입력을 커밋 전에 동기 반영
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
        const flush = pendingFrameCallback;
        pendingFrameCallback = null;
        flush?.();
      }
      dragEnded = true;
      const pointerId = activePointerIdRef.current;
      activeDragRef.current = false;
      activePointerIdRef.current = null;
      activeDragCleanupRef.current = null;
      releaseDragSession();
      if (pointerId !== null && dragTarget.hasPointerCapture(pointerId)) {
        dragTarget.releasePointerCapture(pointerId);
      }
      clearDragCursor();

      dragTarget.removeEventListener('pointermove', handlePointerMove);
      dragTarget.removeEventListener('pointerup', handlePointerEnd);
      dragTarget.removeEventListener('pointercancel', handlePointerEnd);
      dragTarget.removeEventListener('lostpointercapture', finishDrag);
      window.removeEventListener('blur', finishDrag);

      setIsDragging(false);

      // 스마트 가이드 클리어
      useSmartGuidesStore.getState().clearGuides();

      // 실제 드래그가 발생했을 때만 복구
      if (actuallyDragging) {
        dragTarget.style.userSelect = 'auto';
        // 드래그 종료 시 애니메이션 복원
        useGridSelectionStore.getState().setDraggingOrResizing(false);

        // 최종 위치만 부모에 커밋
        const { dx: finalDx, dy: finalDy } = lastSnappedRef.current;
        try {
          onPositionChange?.(finalDx, finalDy);
        } finally {
          finishGesture?.();
          finishGesture = null;
          // 드래그 결과가 최신 의도 - 유예된 외부 동기화는 폐기하고 커밋
          // 이후의 props 재동기화에 맡긴다
          pendingInitialSyncRef.current = null;
        }
      } else {
        // 커밋이 없으므로 드래그 중 유예된 외부 동기화를 지금 반영
        const pendingSync = pendingInitialSyncRef.current;
        if (pendingSync) {
          pendingInitialSyncRef.current = null;
          lastSnappedRef.current = pendingSync;
          setOffset(pendingSync);
        }
      }

      // 세션 중 보류된 disabled 표식 청소 정산 - trailing click이
      // pointerup과 같은 시퀀스로 발화하므로 한 태스크 뒤에 리셋한다
      if (pendingDisabledResetRef.current) {
        pendingDisabledResetRef.current = false;
        disabledResetTimerRef.current = window.setTimeout(() => {
          disabledResetTimerRef.current = null;
          // 그 사이 재활성화됐으면 취소 - 다음 pointerdown이 리셋한다
          if (!disabledRef.current) return;
          // 새 세션이 시작됐으면 취소 - 그 세션의 종료 정산이 다시 스케줄한다
          if (activeDragRef.current) return;
          setWasMoved(false);
          movedThisPressRef.current = false;
          recentPressMovedRef.current = false;
        }, 0);
      }
    };

    const handlePointerEnd = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== activePointerIdRef.current) return;
      finishDrag();
    };

    activeDragCleanupRef.current = finishDrag;
    dragTarget.addEventListener('pointermove', handlePointerMove, {
      passive: true,
    });
    dragTarget.addEventListener('pointerup', handlePointerEnd);
    dragTarget.addEventListener('pointercancel', handlePointerEnd);
    dragTarget.addEventListener('lostpointercapture', finishDrag);
    window.addEventListener('blur', finishDrag);
  };

  useEffect(() => {
    if (!node) return;

    node.addEventListener('pointerdown', handlePointerDown);

    return () => {
      node.removeEventListener('pointerdown', handlePointerDown);
    };
  });

  useEffect(() => {
    return () => {
      activeDragCleanupRef.current?.();
      clearDragCursor();
      // unmount 시 보류 리셋 타이머 정리 (cleanup이 방금 걸었을 수도 있음)
      if (disabledResetTimerRef.current !== null) {
        window.clearTimeout(disabledResetTimerRef.current);
        disabledResetTimerRef.current = null;
      }
    };
  }, []);

  return { ref, dx, dy, wasMoved, isDragging, recentPressMovedRef };
};
