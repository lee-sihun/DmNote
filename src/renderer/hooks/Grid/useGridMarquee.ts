/**
 * Grid 마퀴(범위 선택) 관련 로직 훅
 */

import { useCallback, useEffect } from "react";
import {
  useGridSelectionStore,
  isElementInMarquee,
  getMarqueeRect,
  type SelectedElement,
} from "@stores/useGridSelectionStore";
import type { PluginDisplayElementInternal } from "@src/types/api";

interface UseGridMarqueeParams {
  positions: Record<string, any[]>;
  statPositions: Record<string, any[]>;
  graphPositions: Record<string, any[]>;
  selectedKeyType: string;
  pluginElements: PluginDisplayElementInternal[];
  clientToGridCoords: (
    clientX: number,
    clientY: number
  ) => { x: number; y: number } | null;
}

interface UseGridMarqueeReturn {
  isMarqueeSelecting: boolean;
  marqueeStart: { x: number; y: number } | null;
  marqueeEnd: { x: number; y: number } | null;
  startMarqueeSelection: (x: number, y: number) => void;
  handleMarqueeMouseMove: (e: MouseEvent) => void;
  handleMarqueeMouseUp: () => void;
}

/**
 * 마퀴 선택 훅
 */
export function useGridMarquee({
  positions,
  statPositions,
  graphPositions,
  selectedKeyType,
  pluginElements,
  clientToGridCoords,
}: UseGridMarqueeParams): UseGridMarqueeReturn {
  const isMarqueeSelecting = useGridSelectionStore(
    (state) => state.isMarqueeSelecting
  );
  const startMarqueeSelection = useGridSelectionStore(
    (state) => state.startMarqueeSelection
  );
  const updateMarqueeSelection = useGridSelectionStore(
    (state) => state.updateMarqueeSelection
  );
  const endMarqueeSelection = useGridSelectionStore(
    (state) => state.endMarqueeSelection
  );
  const marqueeStart = useGridSelectionStore((state) => state.marqueeStart);
  const marqueeEnd = useGridSelectionStore((state) => state.marqueeEnd);
  const setSelectedElements = useGridSelectionStore(
    (state) => state.setSelectedElements
  );
  const clearSelection = useGridSelectionStore((state) => state.clearSelection);

  // 마퀴 선택 중 마우스 이동 핸들러
  const handleMarqueeMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isMarqueeSelecting) return;

      const gridCoords = clientToGridCoords(e.clientX, e.clientY);
      if (gridCoords) {
        updateMarqueeSelection(gridCoords.x, gridCoords.y);
      }
    },
    [isMarqueeSelecting, clientToGridCoords, updateMarqueeSelection]
  );

  // 마퀴 선택 완료 시 요소 선택 처리
  const handleMarqueeMouseUp = useCallback(() => {
    if (!isMarqueeSelecting) return;

    const rect = getMarqueeRect(marqueeStart, marqueeEnd);

    // 마퀴 영역이 충분히 크면 범위 내 요소 선택
    if (rect && rect.width > 5 && rect.height > 5) {
      const newSelectedElements: SelectedElement[] = [];

      // 키 요소 체크
      const keyPositions = positions[selectedKeyType] || [];
      keyPositions.forEach((pos, index) => {
        if (pos.hidden) return;
        const elementBounds = {
          x: pos.dx,
          y: pos.dy,
          width: pos.width || 60,
          height: pos.height || 60,
        };
        if (isElementInMarquee(elementBounds, rect)) {
          newSelectedElements.push({
            type: "key",
            id: `key-${index}`,
            index,
          });
        }
      });

      // 통계 요소 체크
      const stats = statPositions[selectedKeyType] || [];
      stats.forEach((pos, index) => {
        if (!pos || pos.hidden) return;
        const elementBounds = {
          x: pos.dx,
          y: pos.dy,
          width: pos.width || 60,
          height: pos.height || 60,
        };
        if (isElementInMarquee(elementBounds, rect)) {
          newSelectedElements.push({
            type: "stat",
            id: `stat-${index}`,
            index,
          });
        }
      });

      // 그래프 요소 체크
      const graphs = graphPositions[selectedKeyType] || [];
      graphs.forEach((pos, index) => {
        if (!pos || pos.hidden) return;
        const elementBounds = {
          x: pos.dx,
          y: pos.dy,
          width: pos.width || 200,
          height: pos.height || 100,
        };
        if (isElementInMarquee(elementBounds, rect)) {
          newSelectedElements.push({
            type: "graph",
            id: `graph-${index}`,
            index,
          });
        }
      });

      // 플러그인 요소 체크 (현재 탭에 속하는 것만)
      pluginElements.forEach((el) => {
        if (el.hidden) return;
        const belongsToCurrentTab = !el.tabId || el.tabId === selectedKeyType;
        if (belongsToCurrentTab && el.measuredSize) {
          const elementBounds = {
            x: el.position.x,
            y: el.position.y,
            width: el.measuredSize.width,
            height: el.measuredSize.height,
          };
          if (isElementInMarquee(elementBounds, rect)) {
            newSelectedElements.push({
              type: "plugin",
              id: el.fullId,
            });
          }
        }
      });

      setSelectedElements(newSelectedElements);
    } else {
      // 마퀴 영역이 작으면 (클릭) 선택 해제
      clearSelection();
    }

    endMarqueeSelection();
  }, [
    isMarqueeSelecting,
    marqueeStart,
    marqueeEnd,
    positions,
    statPositions,
    graphPositions,
    selectedKeyType,
    pluginElements,
    setSelectedElements,
    clearSelection,
    endMarqueeSelection,
  ]);

  // 마퀴 선택 이벤트 등록
  useEffect(() => {
    if (isMarqueeSelecting) {
      document.addEventListener("mousemove", handleMarqueeMouseMove);
      document.addEventListener("mouseup", handleMarqueeMouseUp);

      return () => {
        document.removeEventListener("mousemove", handleMarqueeMouseMove);
        document.removeEventListener("mouseup", handleMarqueeMouseUp);
      };
    }
  }, [isMarqueeSelecting, handleMarqueeMouseMove, handleMarqueeMouseUp]);

  return {
    isMarqueeSelecting,
    marqueeStart,
    marqueeEnd,
    startMarqueeSelection,
    handleMarqueeMouseMove,
    handleMarqueeMouseUp,
  };
}
