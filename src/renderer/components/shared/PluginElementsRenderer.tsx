// 수동 useMemo 콜백 안정화(개별 요소 비교 deps)가 격리 계약의 근거 —
// React Compiler의 deps 재추론이 이를 매 렌더 무효화하지 않도록 명시적으로 제외
// (현재는 exhaustive-deps suppression으로 우발적 bail-out 상태를 의도로 고정)
'use no memo';

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { useStoreWithEqualityFn } from 'zustand/traditional';
import {
  selectPluginRenderList,
  pluginRenderListEqual,
} from '@utils/plugin/pluginRenderList';
import { useKeyStore } from '@stores/data/useKeyStore';
import PluginElementHost from './PluginElementHost';
import type {
  PluginDisplayElementInternal,
  ElementResizeAnchor,
} from '@src/types/plugin/api';
import { invokeExposedAction } from '@utils/displayElementActions';
import { sendBridgeMessageBestEffort } from '@utils/plugin/bridgeMessages';
import { obsApi } from '@api/modules/obsApi';
import { noteMainPluginsReady } from '@plugins/runtime/pluginRuntimeReadiness';
import {
  useGridSelectionStore,
  SelectedElement,
} from '@stores/grid/useGridSelectionStore';

const DEFAULT_POSITION_OFFSET = { x: 0, y: 0 };
const EMPTY_SELECTED_ELEMENTS: SelectedElement[] = [];

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
  onMultiDragStart?: () => void | (() => void);
  onMultiDragEnd?: () => void;
}

export const PluginElementsRenderer: React.FC<PluginElementsRendererProps> = ({
  windowType,
  activeTool,
  positionOffset = DEFAULT_POSITION_OFFSET,
  zoom = 1,
  panX = 0,
  panY = 0,
  isViewportTransforming = false,
  onSelectionContextMenu,
  onMultiDrag,
  onMultiDragStart,
  onMultiDragEnd,
}) => {
  const selectedKeyType = useKeyStore((state) => state.selectedKeyType);
  // 표시 대상 fullId 목록만 구독 - 요소의 state/html 갱신이
  // 리스트 전체 재조정으로 승격되지 않게 (#111 구조 경화)
  const renderIds = useStoreWithEqualityFn(
    usePluginDisplayElementStore,
    useCallback(
      (state: { elements: PluginDisplayElementInternal[] }) =>
        selectPluginRenderList(state, selectedKeyType),
      [selectedKeyType],
    ),
    pluginRenderListEqual,
  );
  // 상위(App)가 렌더마다 새 offset 객체를 만들어도 값이 같으면 참조 유지 —
  // PluginElement의 React.memo가 형제 요소 리렌더를 실제로 막도록 보장
  const stablePositionOffset = useMemo(
    () => positionOffset,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [positionOffset.x, positionOffset.y],
  );

  // 상위(Grid)가 렌더마다 새 콜백을 만들어도 참조가 유지되도록 최신-참조 래퍼로 안정화
  // 정의 여부는 보존해 콜백 유무 분기(멀티드래그 지원 여부 등)를 바꾸지 않음
  const callbacksRef = useRef({
    onSelectionContextMenu,
    onMultiDrag,
    onMultiDragStart,
    onMultiDragEnd,
  });
  // passive effect면 commit~effect 사이에 이전 콜백이 호출될 수 있어 layout 단계에서 갱신
  useLayoutEffect(() => {
    callbacksRef.current = {
      onSelectionContextMenu,
      onMultiDrag,
      onMultiDragStart,
      onMultiDragEnd,
    };
  });
  const stableOnSelectionContextMenu = useMemo(
    () =>
      onSelectionContextMenu
        ? (payload: {
            elementId: string;
            clientX: number;
            clientY: number;
            referenceElement: HTMLDivElement | null;
          }) => callbacksRef.current.onSelectionContextMenu?.(payload) ?? false
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onSelectionContextMenu != null],
  );
  const stableOnMultiDrag = useMemo(
    () =>
      onMultiDrag
        ? (deltaX: number, deltaY: number) =>
            callbacksRef.current.onMultiDrag?.(deltaX, deltaY)
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onMultiDrag != null],
  );
  const stableOnMultiDragStart = useMemo(
    () =>
      onMultiDragStart
        ? () => callbacksRef.current.onMultiDragStart?.()
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onMultiDragStart != null],
  );
  const stableOnMultiDragEnd = useMemo(
    () =>
      onMultiDragEnd
        ? () => callbacksRef.current.onMultiDragEnd?.()
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onMultiDragEnd != null],
  );
  const setElements = usePluginDisplayElementStore(
    (state) => state.setElements,
  );
  const updateElement = usePluginDisplayElementStore(
    (state) => state.updateElement,
  );
  // 현재 탭의 키 개수 - z-order 폴백 계산용. 개수 변화만 구독
  const keyCount = useKeyStore(
    (state) => state.positions[state.selectedKeyType]?.length ?? 0,
  );

  // 선택 상태 가져오기 (main 윈도우에서만 실제 값 사용)
  const selectedElementsRaw = useGridSelectionStore(
    (state) => state.selectedElements,
  );
  const selectedElements: SelectedElement[] =
    windowType === 'main' ? selectedElementsRaw : EMPTY_SELECTED_ELEMENTS;

  // 오버레이에서 메인의 브릿지 메시지 수신
  useEffect(() => {
    if (windowType !== 'overlay') return;

    const unsubscribe = window.api.bridge.on<{
      elements: PluginDisplayElementInternal[];
      ready?: boolean;
    }>('plugin:displayElements:sync', (data) => {
      // 메인이 요소 권위 - 준비 완료를 받아야 오버레이 리빌 게이트가 열린다
      if (data?.ready) {
        noteMainPluginsReady();
      }
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

    const requestElementsFromMain = () => {
      sendBridgeMessageBestEffort('main', 'plugin:displayElements:request', {});
    };

    // 오버레이 초기 로드 시 메인에 현재 상태 요청
    requestElementsFromMain();

    // OBS WS 재연결/lag 복구 시 재요청 (단절 중 유실된 sync 복구)
    const unsubResync = obsApi.onResync(requestElementsFromMain);

    return () => {
      unsubscribe();
      unsubResync();
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

  // 메인 윈도우의 상태 요청 응답은 usePluginDisplayElementsResponder가 담당
  // (Grid 언마운트 시에도 응답 가능하도록 main App 레벨에 상시 마운트)

  // 메인 윈도우에서 오버레이의 앵커 업데이트 요청 처리
  useEffect(() => {
    if (windowType !== 'main') return;

    const unsubscribe = window.api.bridge.on<{
      fullId: string;
      resizeAnchor: string;
    }>('plugin:displayElement:updateAnchor', (data) => {
      if (data?.fullId && data?.resizeAnchor) {
        updateElement(data.fullId, {
          resizeAnchor: data.resizeAnchor as ElementResizeAnchor,
        });
      }
    });

    return () => {
      unsubscribe();
    };
  }, [windowType, updateElement]);

  // 메뉴 predicate용 상태 동기화(contextMenuStateKeys) 수신은
  // usePluginDisplayElementsResponder가 담당 — Grid 언마운트 중에도 유실 방지

  return (
    <>
      {renderIds.map((fullId, index) => (
        <PluginElementHost
          key={fullId}
          fullId={fullId}
          windowType={windowType}
          activeTool={activeTool}
          positionOffset={stablePositionOffset}
          zoom={zoom}
          panX={panX}
          panY={panY}
          isViewportTransforming={isViewportTransforming}
          arrayIndex={index}
          keyCount={keyCount}
          isSelected={selectedElements.some(
            (sel) => sel.type === 'plugin' && sel.id === fullId,
          )}
          selectedElements={selectedElements}
          onSelectionContextMenu={stableOnSelectionContextMenu}
          onMultiDrag={stableOnMultiDrag}
          onMultiDragStart={stableOnMultiDragStart}
          onMultiDragEnd={stableOnMultiDragEnd}
        />
      ))}
    </>
  );
};
