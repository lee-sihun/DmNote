import React, { useEffect } from 'react';
import { usePluginDisplayElementStore } from '@stores/usePluginDisplayElementStore';
import { useKeyStore } from '@stores/useKeyStore';
import { PluginElement } from './PluginElement';
import type { PluginDisplayElementInternal, ElementResizeAnchor } from '@src/types/api';
import { invokeExposedAction } from '@utils/displayElementActions';
import {
  useGridSelectionStore,
  SelectedElement,
} from '@stores/useGridSelectionStore';

/**
 * Main에서 온 elements와 Overlay의 기존 elements를 병합
 * - Main에서 온 데이터: position, settings 등 동기화 필요한 필드
 * - Overlay에서 유지: state (로컬에서만 관리되는 런타임 데이터)
 */
function mergeElementsFromMain(
  incomingElements: PluginDisplayElementInternal[],
  existingElements: PluginDisplayElementInternal[],
): PluginDisplayElementInternal[] {
  return incomingElements.map((incoming) => {
    const existing = existingElements.find(
      (el) => el.fullId === incoming.fullId,
    );

    if (existing && existing.state) {
      // 기존 요소가 있고 state가 있으면: Main 데이터 + Overlay의 state 유지
      return {
        ...incoming,
        state: existing.state,
      };
    }

    // 새 요소이거나 state가 없으면 그대로 사용
    return incoming;
  });
}

interface PluginElementsRendererProps {
  windowType: 'main' | 'overlay';
  activeTool?: string;
  positionOffset?: { x: number; y: number };
  zoom?: number;
  panX?: number;
  panY?: number;
  isViewportTransforming?: boolean;
  onSelectionContextMenu?: (payload: {
    elementId: string;
    clientX: number;
    clientY: number;
    referenceElement: HTMLDivElement | null;
  }) => boolean;
  onMultiDrag?: (deltaX: number, deltaY: number) => void;
  onMultiDragStart?: () => void;
  onMultiDragEnd?: () => void;
}

export const PluginElementsRenderer: React.FC<PluginElementsRendererProps> = ({
  windowType,
  activeTool,
  positionOffset = { x: 0, y: 0 },
  zoom = 1,
  panX = 0,
  panY = 0,
  isViewportTransforming = false,
  onSelectionContextMenu,
  onMultiDrag,
  onMultiDragStart,
  onMultiDragEnd,
}) => {
  const elements = usePluginDisplayElementStore((state) => state.elements);
  const setElements = usePluginDisplayElementStore(
    (state) => state.setElements,
  );
  const updateElement = usePluginDisplayElementStore(
    (state) => state.updateElement,
  );
  const { selectedKeyType, positions } = useKeyStore();

  // 현재 탭의 키 개수
  const keyCount = positions[selectedKeyType]?.length ?? 0;

  // 선택 상태 가져오기 (main 윈도우에서만 실제 값 사용)
  const selectedElementsRaw = useGridSelectionStore(
    (state) => state.selectedElements,
  );
  const selectedElements: SelectedElement[] =
    windowType === 'main' ? selectedElementsRaw : [];

  // 현재 탭에 해당하는 요소만 필터링
  const filteredElements = elements.filter((el) => {
    if (el.hidden) return false;
    // tabId가 없으면(레거시) 모든 탭에 표시하거나, 정책에 따라 처리
    // 여기서는 tabId가 있는 경우 현재 탭과 일치하는지 확인
    if (el.tabId) {
      return el.tabId === selectedKeyType;
    }
    return true; // tabId가 없으면 항상 표시 (하위 호환성)
  });

  // 오버레이에서 메인의 브릿지 메시지 수신
  useEffect(() => {
    if (windowType !== 'overlay') return;

    const unsubscribe = window.api.bridge.on<{
      elements: PluginDisplayElementInternal[];
    }>('plugin:displayElements:sync', (data) => {
      if (data?.elements) {
        // Main에서 온 데이터와 Overlay의 기존 state를 병합
        const currentElements =
          usePluginDisplayElementStore.getState().elements;
        const mergedElements = mergeElementsFromMain(
          data.elements,
          currentElements,
        );
        setElements(mergedElements);
      }
    });

    // 오버레이 초기 로드 시 메인에 현재 상태 요청
    window.api.bridge.sendTo('main', 'plugin:displayElements:request', {});

    return () => {
      unsubscribe();
    };
  }, [windowType, setElements]);

  // overlay 창에서 expose 함수를 호출 할 수 있도록 브릿지 연결
  useEffect(() => {
    if (windowType !== 'overlay') return;

    const unsubscribe = window.api.bridge.on<{
      elementId: string;
      action: string;
      args?: unknown[];
    }>('plugin:displayElement:invokeAction', async (data) => {
      if (!data?.elementId || !data?.action) return;
      await invokeExposedAction(
        data.elementId,
        data.action,
        Array.isArray(data.args) ? data.args : [],
      );
    });

    return () => {
      unsubscribe();
    };
  }, [windowType]);

  // 메인 윈도우에서 오버레이의 상태 요청 처리
  useEffect(() => {
    if (windowType !== 'main') return;

    const unsubscribe = window.api.bridge.on(
      'plugin:displayElements:request',
      () => {
        // 현재 상태를 오버레이로 전송
        const currentElements =
          usePluginDisplayElementStore.getState().elements;
        window.api.bridge.sendTo('overlay', 'plugin:displayElements:sync', {
          elements: currentElements,
        });
      },
    );

    return () => {
      unsubscribe();
    };
  }, [windowType]);

  // 메인 윈도우에서 오버레이의 앵커 업데이트 요청 처리
  useEffect(() => {
    if (windowType !== 'main') return;

    const unsubscribe = window.api.bridge.on<{
      fullId: string;
      resizeAnchor: string;
    }>('plugin:displayElement:updateAnchor', (data) => {
      if (data?.fullId && data?.resizeAnchor) {
        updateElement(data.fullId, { resizeAnchor: data.resizeAnchor as ElementResizeAnchor });
      }
    });

    return () => {
      unsubscribe();
    };
  }, [windowType, updateElement]);

  return (
    <>
      {filteredElements.map((element, index) => (
        <PluginElement
          key={element.fullId}
          element={element}
          windowType={windowType}
          activeTool={activeTool}
          positionOffset={positionOffset}
          zoom={zoom}
          panX={panX}
          panY={panY}
          isViewportTransforming={isViewportTransforming}
          arrayIndex={index}
          keyCount={keyCount}
          isSelected={selectedElements.some(
            (sel) => sel.type === 'plugin' && sel.id === element.fullId,
          )}
          selectedElements={selectedElements}
          onSelectionContextMenu={onSelectionContextMenu}
          onMultiDrag={onMultiDrag}
          onMultiDragStart={onMultiDragStart}
          onMultiDragEnd={onMultiDragEnd}
        />
      ))}
    </>
  );
};
