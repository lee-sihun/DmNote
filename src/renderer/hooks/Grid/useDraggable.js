import { useState, useEffect, useCallback, useRef } from "react";
import { MIN_GRID_POSITION, MAX_GRID_POSITION } from "@stores/useGridViewStore";
import { useSmartGuidesStore } from "@stores/useSmartGuidesStore";
import { useGridSelectionStore } from "@stores/useGridSelectionStore";
import { useSettingsStore } from "@stores/useSettingsStore";
import { calculateBounds, calculateSnapPoints } from "@utils/smartGuides";
import { DRAG_THRESHOLD } from "./constants";

// 위치 클램핑 함수
const clampPosition = (value) => {
  return Math.min(Math.max(value, MIN_GRID_POSITION), MAX_GRID_POSITION);
};

// 줌 레벨에 따른 동적 그리드 스냅 크기 계산
// 화면상 일정한 드래그 거리를 유지하면서 최소 1px 보장
const MIN_GRID_SIZE = 1;

const calculateDynamicGridSize = (zoom, baseGridSize) => {
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
  elementId = "", // 요소 식별자
  elementWidth = 60, // 요소 너비
  elementHeight = 60, // 요소 높이
  getOtherElements = null, // 다른 요소들의 bounds를 반환하는 함수
  disabled = false, // 드래그 비활성화 옵션
}) => {
  const [node, setNode] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [wasMoved, setWasMoved] = useState(false);
  const [{ dx, dy }, setOffset] = useState({ dx: initialX, dy: initialY });

  // 마지막 스냅 좌표를 ref로 보관 (mouseup 시 커밋)
  const lastSnappedRef = useRef({ dx: initialX, dy: initialY });
  // 드래그 감지를 위한 최소 거리 임계값
  const dragThresholdRef = useRef(DRAG_THRESHOLD);

  // 줌/팬 값을 ref로 저장 (드래그 중 최신 값 참조)
  const zoomRef = useRef(zoom);
  const panXRef = useRef(panX);
  const panYRef = useRef(panY);

  // 스마트 가이드 관련 ref
  const elementIdRef = useRef(elementId);
  const elementWidthRef = useRef(elementWidth);
  const elementHeightRef = useRef(elementHeight);
  const getOtherElementsRef = useRef(getOtherElements);
  const disabledRef = useRef(disabled);
  const previousBodyCursorRef = useRef(null);

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

  // initialX, initialY 변경 시 동기화
  useEffect(() => {
    setOffset({ dx: initialX, dy: initialY });
    lastSnappedRef.current = { dx: initialX, dy: initialY };
  }, [initialX, initialY]);

  const ref = useCallback((nodeEle) => {
    setNode(nodeEle);
  }, []);

  const restoreBodyCursor = useCallback(() => {
    if (typeof document === "undefined") return;
    if (previousBodyCursorRef.current === null) return;
    document.body.style.cursor = previousBodyCursorRef.current;
    previousBodyCursorRef.current = null;
  }, []);

  const setBodyCursor = useCallback((cursor) => {
    if (typeof document === "undefined") return;
    if (previousBodyCursorRef.current === null) {
      previousBodyCursorRef.current = document.body.style.cursor || "";
    }
    document.body.style.cursor = cursor;
  }, []);

  const handleMouseOver = useCallback(() => {
    // 미들 버튼 드래그 중이면 커서 변경하지 않음
    if (useGridSelectionStore.getState().isMiddleButtonDragging) return;
    if (node && !isDragging) node.style.cursor = "grab";
  }, [node, isDragging]);

  const handleMouseOut = useCallback(() => {
    // 미들 버튼 드래그 중이면 커서 변경하지 않음
    if (useGridSelectionStore.getState().isMiddleButtonDragging) return;
    if (node && !isDragging) node.style.cursor = "";
  }, [node, isDragging]);

  const handleMouseDown = useCallback(
    (e) => {
      if (!node) return;

      // 좌클릭만 처리 (미들 버튼은 그리드 팬에 사용)
      if (e.button !== 0) return;

      // disabled 상태면 드래그 무시
      if (disabledRef.current) return;

      // 미들 버튼 드래그 중이면 요소 드래그 무시 (그리드 팬 우선)
      if (useGridSelectionStore.getState().isMiddleButtonDragging) return;

      // 드래그 시작 전 기존 스마트 가이드 클리어 (이전 드래그가 정상 종료되지 않은 경우 대비)
      useSmartGuidesStore.getState().clearGuides();

      // 마우스 다운 시점의 위치 저장
      const startClientX = e.clientX;
      const startClientY = e.clientY;
      let actuallyDragging = false;

      setIsDragging(true);
      setWasMoved(false);

      // 현재 줌/팬 값 캡처
      const currentZoom = zoomRef.current;

      // gridSettings에서 스냅 크기 가져오기
      const gridSnapSize = useSettingsStore.getState().gridSettings?.gridSnapSize || 5;

      // 줌 레벨에 따른 동적 그리드 크기 계산
      const dynamicGridSize = calculateDynamicGridSize(currentZoom, gridSnapSize);

      // 무한 캔버스에서는 경계 제한 없음
      // 시작 위치 계산 (줌 반영)
      const startPos = {
        x: e.clientX - dx * currentZoom,
        y: e.clientY - dy * currentZoom,
      };
      const initialPosition = { dx, dy };

      let rafId = null;
      // 드래그 종료 플래그 (rAF 콜백에서 체크)
      let dragEnded = false;
      // Shift 키 드래그 시 축 고정을 위한 변수
      let lockedAxis = null; // 'x' | 'y' | null

      // 스마트 가이드 스토어 참조
      const smartGuidesStore = useSmartGuidesStore.getState();

      const handleMouseMove = (moveEvent) => {
        // 드래그가 종료되었으면 무시
        if (dragEnded) return;

        // 드래그 임계값 체크
        const deltaX = Math.abs(moveEvent.clientX - startClientX);
        const deltaY = Math.abs(moveEvent.clientY - startClientY);

        if (
          !actuallyDragging &&
          (deltaX > dragThresholdRef.current ||
            deltaY > dragThresholdRef.current)
        ) {
          actuallyDragging = true;
          node.style.cursor = "grabbing";
          setBodyCursor("grabbing");
          // 실제 드래그가 시작될 때만 최적화 적용
          node.style.pointerEvents = "none";
          node.style.userSelect = "none";
          // 드래그 시작 시 애니메이션 비활성화
          useGridSelectionStore.getState().setDraggingOrResizing(true);
          // 드래그 시작 콜백 호출 (히스토리 저장용)
          onDragStart?.();

          // Shift 키가 눌려있으면 처음 움직인 방향으로 축 고정
          if (moveEvent.shiftKey && lockedAxis === null) {
            lockedAxis = deltaX >= deltaY ? "x" : "y";
          }
        }

        if (!actuallyDragging) return;

        if (rafId) return;
        rafId = requestAnimationFrame(() => {
          rafId = null;

          // 드래그가 종료되었으면 rAF 콜백에서도 무시
          if (dragEnded) return;

          // 줌 레벨을 고려한 좌표 계산
          let newDx = (moveEvent.clientX - startPos.x) / currentZoom;
          let newDy = (moveEvent.clientY - startPos.y) / currentZoom;

          // Shift 키로 축이 고정된 경우 해당 축만 이동
          if (lockedAxis === "x") {
            newDy = initialPosition.dy;
          } else if (lockedAxis === "y") {
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
          const alignmentGuidesEnabled =
            gridSettings?.alignmentGuides !== false;
          const spacingGuidesEnabled = gridSettings?.spacingGuides !== false;

          if (
            getOtherElementsFn &&
            currentElementId &&
            alignmentGuidesEnabled
          ) {
            const otherElements = getOtherElementsFn(currentElementId);
            const draggedBounds = calculateBounds(
              newDx,
              newDy,
              currentWidth,
              currentHeight,
              currentElementId
            );

            const snapResult = calculateSnapPoints(
              draggedBounds,
              otherElements,
              undefined,
              { disableSpacing: !spacingGuidesEnabled }
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
                currentElementId
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
          let snappedX;
          if (didSmartSnapX) {
            snappedX = clampPosition(Math.round(finalX));
          } else {
            snappedX = clampPosition(
              Math.round(finalX / dynamicGridSize) * dynamicGridSize
            );
          }

          // Y축: 스마트 가이드로 스냅되지 않은 경우에만 기본 그리드 스냅 적용
          let snappedY;
          if (didSmartSnapY) {
            snappedY = clampPosition(Math.round(finalY));
          } else {
            snappedY = clampPosition(
              Math.round(finalY / dynamicGridSize) * dynamicGridSize
            );
          }

          if (
            snappedX !== initialPosition.dx ||
            snappedY !== initialPosition.dy
          ) {
            setWasMoved(true);
          }

          lastSnappedRef.current = { dx: snappedX, dy: snappedY };
          setOffset({ dx: snappedX, dy: snappedY });
        });
      };

      const handleMouseUp = () => {
        // 드래그 종료 플래그 설정 (pending rAF 콜백이 실행되지 않도록)
        dragEnded = true;
        restoreBodyCursor();

        // pending rAF가 있으면 취소
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }

        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        window.removeEventListener("blur", handleMouseUp);

        setIsDragging(false);

        // 스마트 가이드 클리어
        useSmartGuidesStore.getState().clearGuides();

        // 실제 드래그가 발생했을 때만 복구
        if (actuallyDragging) {
          node.style.cursor = "grab";
          node.style.pointerEvents = "auto";
          node.style.userSelect = "auto";
          // 드래그 종료 시 애니메이션 복원
          useGridSelectionStore.getState().setDraggingOrResizing(false);

          // 최종 위치만 부모에 커밋
          const { dx: finalDx, dy: finalDy } = lastSnappedRef.current;
          onPositionChange?.(finalDx, finalDy);
        } else {
          // 클릭만 했을 경우 커서만 복구
          node.style.cursor = "grab";
        }
      };

      document.addEventListener("mousemove", handleMouseMove, {
        passive: true,
      });
      document.addEventListener("mouseup", handleMouseUp);
      window.addEventListener("blur", handleMouseUp);
    },
    [node, dx, dy, onPositionChange, restoreBodyCursor, setBodyCursor]
  );

  useEffect(() => {
    if (!node) return;

    node.addEventListener("mousedown", handleMouseDown);
    node.addEventListener("mouseenter", handleMouseOver);
    node.addEventListener("mouseleave", handleMouseOut);

    return () => {
      node.removeEventListener("mousedown", handleMouseDown);
      node.removeEventListener("mouseenter", handleMouseOver);
      node.removeEventListener("mouseleave", handleMouseOut);
    };
  }, [node, handleMouseDown, handleMouseOver, handleMouseOut]);

  useEffect(() => {
    return () => {
      restoreBodyCursor();
    };
  }, [restoreBodyCursor]);

  return { ref, dx, dy, wasMoved, isDragging };
};
