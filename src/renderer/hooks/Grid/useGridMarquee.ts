/**
 * Grid 마퀴(범위 선택) 관련 로직 훅
 */

import { useEffect, useRef } from 'react';
import {
  selectionElementId,
  useGridSelectionStore,
  isElementInMarquee,
  getMarqueeRect,
  type SelectedElement,
} from '@stores/grid/useGridSelectionStore';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';
import type { KeyPositions } from '@src/types/key/keys';
import type { StatItemPositions } from '@src/types/key/statItems';
import type { GraphItemPositions } from '@src/types/key/graphItems';
import type { KnobItemPositions } from '@src/types/key/knobs';

interface UseGridMarqueeParams {
  positions: KeyPositions;
  statPositions: StatItemPositions;
  graphPositions: GraphItemPositions;
  knobPositions: KnobItemPositions;
  selectedKeyType: string;
  pluginElements: PluginDisplayElementInternal[];
  clientToGridCoords: (
    clientX: number,
    clientY: number,
  ) => { x: number; y: number } | null;
  /** benchmark에서 제거 전 이벤트 처리 경로를 재현 */
  continuousInputStrategy?: 'legacy' | 'frame';
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
  knobPositions,
  selectedKeyType,
  pluginElements,
  clientToGridCoords,
  continuousInputStrategy = 'frame',
}: UseGridMarqueeParams): UseGridMarqueeReturn {
  const isMarqueeSelecting = useGridSelectionStore(
    (state) => state.isMarqueeSelecting,
  );
  const startMarqueeSelection = useGridSelectionStore(
    (state) => state.startMarqueeSelection,
  );
  const updateMarqueeSelection = useGridSelectionStore(
    (state) => state.updateMarqueeSelection,
  );
  const endMarqueeSelection = useGridSelectionStore(
    (state) => state.endMarqueeSelection,
  );
  const marqueeStart = useGridSelectionStore((state) => state.marqueeStart);
  const marqueeEnd = useGridSelectionStore((state) => state.marqueeEnd);
  const setSelectedElements = useGridSelectionStore(
    (state) => state.setSelectedElements,
  );
  const clearSelection = useGridSelectionStore((state) => state.clearSelection);
  const frameRef = useRef<number | null>(null);
  const pendingClientPointRef = useRef<{ x: number; y: number } | null>(null);

  const applyPendingMarquee = () => {
    const point = pendingClientPointRef.current;
    pendingClientPointRef.current = null;
    if (!point) return;
    const gridCoords = clientToGridCoords(point.x, point.y);
    if (gridCoords) {
      updateMarqueeSelection(gridCoords.x, gridCoords.y);
    }
  };

  // 마퀴 선택 중 마우스 이동 핸들러
  const handleMarqueeMouseMove = (e: MouseEvent) => {
    if (!isMarqueeSelecting) return;
    pendingClientPointRef.current = { x: e.clientX, y: e.clientY };
    if (continuousInputStrategy === 'legacy') {
      applyPendingMarquee();
      return;
    }
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      applyPendingMarquee();
    });
  };

  // 마퀴 선택 완료 시 요소 선택 처리
  const handleMarqueeMouseUp = () => {
    if (!isMarqueeSelecting) return;
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      applyPendingMarquee();
    }

    const selectionState = useGridSelectionStore.getState();
    const rect = getMarqueeRect(
      selectionState.marqueeStart,
      selectionState.marqueeEnd,
    );

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
            type: 'key',
            id: selectionElementId('key', pos, index),
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
            type: 'stat',
            id: selectionElementId('stat', pos, index),
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
            type: 'graph',
            id: selectionElementId('graph', pos, index),
            index,
          });
        }
      });

      // 노브 요소 체크
      const knobs = knobPositions[selectedKeyType] || [];
      knobs.forEach((pos, index) => {
        if (!pos || pos.hidden) return;
        const elementBounds = {
          x: pos.dx,
          y: pos.dy,
          width: pos.width || 60,
          height: pos.height || 60,
        };
        if (isElementInMarquee(elementBounds, rect)) {
          newSelectedElements.push({
            type: 'knob',
            id: selectionElementId('knob', pos, index),
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
              type: 'plugin',
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
  };

  // 마퀴 선택 이벤트 등록
  useEffect(() => {
    if (isMarqueeSelecting) {
      document.addEventListener('mousemove', handleMarqueeMouseMove);
      document.addEventListener('mouseup', handleMarqueeMouseUp);

      return () => {
        if (frameRef.current !== null) {
          cancelAnimationFrame(frameRef.current);
          frameRef.current = null;
        }
        pendingClientPointRef.current = null;
        document.removeEventListener('mousemove', handleMarqueeMouseMove);
        document.removeEventListener('mouseup', handleMarqueeMouseUp);
      };
    }
  });

  return {
    isMarqueeSelecting,
    marqueeStart,
    marqueeEnd,
    startMarqueeSelection,
    handleMarqueeMouseMove,
    handleMarqueeMouseUp,
  };
}
