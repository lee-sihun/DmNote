/**
 * Grid 마퀴(범위 선택) 관련 로직 훅
 */

import { useEffect, useRef } from 'react';
import {
  useGridSelectionStore,
  isElementInMarquee,
  getMarqueeRect,
  type SelectedElement,
} from '@stores/grid/useGridSelectionStore';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';
import type { CanonicalEditorDocumentV1 } from '@src/types/editor';
import { getActiveElement } from '@utils/dom/activeElement';
import { isHTMLElementNode } from '@utils/dom/isElementNode';

interface UseGridMarqueeParams {
  positions: CanonicalEditorDocumentV1['keyPositions'];
  statPositions: CanonicalEditorDocumentV1['statPositions'];
  graphPositions: CanonicalEditorDocumentV1['graphPositions'];
  knobPositions: CanonicalEditorDocumentV1['knobPositions'];
  // Grid 배선 전에도 훅이 동작하도록 선택 인자 - 미전달 시 스프라이트만 제외
  spritePositions?: CanonicalEditorDocumentV1['spritePositions'];
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
  spritePositions = {},
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

  // 빈 공간 프레스 즉시 선택 해제 - 피커 클릭어웨이(mousedown)와 같은 이벤트라
  // 상태 프리뷰 복귀와 포커스 해제가 한 프레임에 함께 꺼진다. 마퀴는 어차피
  // 선택을 통째로 교체하므로 미리 비워도 최종 결과가 같다.
  // 단 포커스된 편집 입력이 있으면 즉시 해제를 건너뛴다 - 여기서 비우면 입력이
  // blur 전에 언마운트돼 미확정 draft가 사라진다 (언마운트는 blur를 만들지 않고
  // cleanup은 finalize를 부르지 않는다). 이 경우 브라우저 기본 blur가 finalize를
  // 마친 뒤 mouseup 정산(작은 마퀴 = 선택 해제)이 비운다
  const beginMarqueeSelection = (x: number, y: number) => {
    if (useGridSelectionStore.getState().selectedElements.length > 0) {
      const active = getActiveElement();
      const editing =
        isHTMLElementNode(active) &&
        active.matches('input, textarea, [contenteditable="true"]');
      if (!editing) {
        clearSelection();
      }
    }
    startMarqueeSelection(x, y);
  };

  // 리스너 가드는 스토어를 직접 읽는다 - 취소 setState와 React 플러시 사이에 끼어든
  // mouseup이 렌더 캡처 값(true)으로 옛 마퀴를 확정·해제하지 않게
  const isMarqueeActive = () =>
    useGridSelectionStore.getState().isMarqueeSelecting;

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
    if (!isMarqueeActive()) return;
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
    if (!isMarqueeActive()) return;
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
            id: pos.id,
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
            id: pos.id,
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
            id: pos.id,
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
            id: pos.id,
            index,
          });
        }
      });

      // 스프라이트 요소 체크
      const sprites = spritePositions[selectedKeyType] || [];
      sprites.forEach((pos, index) => {
        if (!pos || pos.hidden) return;
        const elementBounds = {
          x: pos.dx,
          y: pos.dy,
          width: pos.width || 60,
          height: pos.height || 60,
        };
        if (isElementInMarquee(elementBounds, rect)) {
          newSelectedElements.push({
            type: 'sprite',
            id: pos.id,
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

  const cancelMarqueeSelection = () => {
    if (!isMarqueeActive()) return;
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    pendingClientPointRef.current = null;
    endMarqueeSelection();
  };

  // 보조 버튼 프레스는 확정이 아니라 취소 - contextmenu보다 반드시 먼저 오는 유일한 신호.
  // WKWebView는 mousedown → contextmenu → mouseup, Chromium/WebView2는
  // mousedown → mouseup → contextmenu 순이라 mouseup을 기다리면 먼저 선택이 확정된다.
  // contextmenu 리스너는 키보드 기동(Shift+F10) 대비로 유지
  const cancelOnSecondaryPress = (e: MouseEvent) => {
    if (e.button === 0) return;
    cancelMarqueeSelection();
  };

  // 마퀴 선택 이벤트 등록
  useEffect(() => {
    if (isMarqueeSelecting) {
      document.addEventListener('mousemove', handleMarqueeMouseMove);
      document.addEventListener('mouseup', handleMarqueeMouseUp);
      document.addEventListener('mousedown', cancelOnSecondaryPress, true);
      document.addEventListener('contextmenu', cancelMarqueeSelection, true);
      window.addEventListener('blur', cancelMarqueeSelection);

      return () => {
        if (frameRef.current !== null) {
          cancelAnimationFrame(frameRef.current);
          frameRef.current = null;
        }
        pendingClientPointRef.current = null;
        document.removeEventListener('mousemove', handleMarqueeMouseMove);
        document.removeEventListener('mouseup', handleMarqueeMouseUp);
        document.removeEventListener('mousedown', cancelOnSecondaryPress, true);
        document.removeEventListener(
          'contextmenu',
          cancelMarqueeSelection,
          true,
        );
        window.removeEventListener('blur', cancelMarqueeSelection);
      };
    }
  });

  return {
    isMarqueeSelecting,
    marqueeStart,
    marqueeEnd,
    startMarqueeSelection: beginMarqueeSelection,
    handleMarqueeMouseMove,
    handleMarqueeMouseUp,
  };
}
