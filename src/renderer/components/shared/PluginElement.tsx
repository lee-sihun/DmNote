import React, { useRef, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { isMac } from '@utils/core/platform';
import {
  PluginDisplayElementInternal,
  DisplayElementTemplateHelpers,
} from '@src/types/plugin/api';
import { useDraggable } from '@hooks/Grid';
import { useSelectionDrag } from '@hooks/Grid/useSelectionDrag';
import { useSmartGuidesElements } from '@hooks/Grid';
import { useSettingsStore } from '@stores/useSettingsStore';
import {
  useGridSelectionStore,
  SelectedElement,
  isElementInMarquee,
} from '@stores/grid/useGridSelectionStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { openPropertiesPanelForSelection } from '@stores/grid/usePanelHostStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useTranslation } from '@contexts/useTranslation';
import { html, styleMap, css } from '@utils/plugin/templateEngine';
import { translatePluginMessage } from '@utils/plugin/pluginI18n';
import {
  beginPluginInstancesEditSession,
  endPluginInstancesEditSession,
} from '@plugins/runtime/displayElement/instancesCommitQueue';
import { expandGroupSelectionFromStores } from '@utils/grid/groupSelection';
import {
  buildPluginElementStyle,
  buildPluginOverlayHitStyle,
  resolvePluginElementPosition,
} from '@utils/plugin/pluginElementLayout';
import { usePluginElementContextMenu } from './usePluginElementContextMenu';
import { usePluginElementMeasurementRuntime } from './usePluginElementMeasurementRuntime';
import { usePluginElementOverlayRuntime } from './usePluginElementOverlayRuntime';

const DEFAULT_POSITION_OFFSET = { x: 0, y: 0 };
const EMPTY_SELECTED_ELEMENTS: SelectedElement[] = [];
// scoped 플러그인 shadow tree에 주입되는 커서 정책 스타일 식별자
const SHADOW_CURSOR_STYLE_ATTR = 'data-dmn-cursor-policy';

interface PluginElementProps {
  element: PluginDisplayElementInternal;
  windowType: 'main' | 'overlay';
  activeTool?: string;
  positionOffset?: { x: number; y: number };
  zoom?: number;
  panX?: number;
  panY?: number;
  isViewportTransforming?: boolean;
  arrayIndex?: number;
  keyCount?: number;
  isSelected?: boolean;
  selectedElements?: SelectedElement[];
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

const PluginElementImpl: React.FC<PluginElementProps> = ({
  element,
  windowType,
  activeTool,
  positionOffset = DEFAULT_POSITION_OFFSET,
  zoom = 1,
  panX = 0,
  panY = 0,
  isViewportTransforming = false,
  arrayIndex = 0,
  keyCount = 0,
  isSelected = false,
  selectedElements = EMPTY_SELECTED_ELEMENTS,
  onSelectionContextMenu,
  onMultiDrag,
  onMultiDragStart,
  onMultiDragEnd,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [shadowRoot, setShadowRoot] = useState<ShadowRoot | null>(null);
  const updateElement = usePluginDisplayElementStore(
    (state) => state.updateElement,
  );
  const updateElementBatched = usePluginDisplayElementStore(
    (state) => state.updateElementBatched,
  );
  const definitions = usePluginDisplayElementStore(
    (state) => state.definitions,
  );
  const definition = element.definitionId
    ? definitions.get(element.definitionId)
    : undefined;
  const { i18n, t } = useTranslation();
  const locale = i18n.language;
  const localeRef = useRef(locale);

  const pluginTranslate = (
    key: string,
    params?: Record<string, string | number>,
    fallback?: string,
  ) =>
    translatePluginMessage({
      messages: definition?.messages,
      locale,
      key,
      params,
      fallback,
    });

  useEffect(() => {
    localeRef.current = locale;
  }, [locale]);

  const pluginTranslateStable = (
    key: string,
    params?: Record<string, string | number>,
    fallback?: string,
  ) =>
    translatePluginMessage({
      messages: definition?.messages,
      locale: localeRef.current,
      key,
      params,
      fallback,
    });

  const { contextMenu, deletePluginElement, handleContextMenu } =
    usePluginElementContextMenu({
      element,
      definition,
      windowType,
      locale,
      containerRef,
      onSelectionContextMenu,
      t,
    });

  const positions = useKeyStore((state) => state.positions);
  const selectedKeyType = useKeyStore((state) => state.selectedKeyType);
  // Settings 변경 감지용 ref와 콜백 리스트
  const prevSettingsRef = useRef<Record<string, unknown> | null>(null);
  const settingsChangeListenersRef = useRef<
    Set<
      (
        newSettings: Record<string, unknown>,
        oldSettings: Record<string, unknown>,
      ) => void
    >
  >(new Set());

  // Settings 변경 감지 (overlay에서만 - 리스너 콜백용)
  useEffect(() => {
    if (windowType !== 'overlay') return;

    const currentSettings = element.settings || {};
    const prevSettings = prevSettingsRef.current;

    // 최초 마운트 시에는 이전 설정 저장만
    if (prevSettings === null) {
      prevSettingsRef.current = { ...currentSettings };
      return;
    }

    // 설정이 실제로 변경되었는지 확인
    const hasChanged =
      JSON.stringify(currentSettings) !== JSON.stringify(prevSettings);

    if (hasChanged) {
      // 모든 리스너에게 변경 알림
      settingsChangeListenersRef.current.forEach((listener) => {
        try {
          listener(currentSettings, prevSettings);
        } catch (error) {
          console.error(
            '[PluginElement] onSettingsChange listener error:',
            error,
          );
        }
      });

      // 이전 설정 업데이트
      prevSettingsRef.current = { ...currentSettings };
    }
  }, [windowType, element.settings]);

  const calculatedPosition = resolvePluginElementPosition({
    element,
    positions,
    keyMappings: useKeyStore.getState().keyMappings,
    selectedKeyType,
    positionOffset,
  });

  // 스마트 가이드를 위한 다른 요소들의 bounds 가져오기
  const { getOtherElements } = useSmartGuidesElements();

  // 그리드 스냅 크기 가져오기
  const gridSnapSize = useSettingsStore(
    (state) => state.gridSettings?.gridSnapSize ?? 5,
  );

  // 선택 드래그 상태

  // 선택된 상태면 선택 모드 활성화
  const isSelectionMode = isSelected;

  // 드래그/리사이즈 중인 상태 (CSS 애니메이션 비활성화용, main 윈도우에서만)
  const isDraggingOrResizing = useGridSelectionStore((state) =>
    windowType === 'main' ? state.isDraggingOrResizing : false,
  );

  // 드래그 지원 (main 윈도우에서만)
  const draggable = useDraggable({
    gridSize: gridSnapSize,
    initialX: calculatedPosition.x,
    initialY: calculatedPosition.y,
    onDragStart: () => {
      const token = beginPluginInstancesEditSession(element.pluginId);
      return () => endPluginInstancesEditSession(element.pluginId, token);
    },
    onPositionChange: (newX, newY) => {
      // 선택 모드가 아닐 때만 개별 이동
      if (windowType === 'main' && element.draggable && !isSelectionMode) {
        updateElement(element.fullId, {
          position: { x: newX, y: newY },
          anchor: undefined, // 드래그하면 앵커 제거
        });

        // onPositionChange 핸들러 호출 (자동 래핑되어 있음)
        if (
          element.onPositionChange &&
          typeof element.onPositionChange === 'string'
        ) {
          const handler = (window as unknown as Record<string, unknown>)[
            element.onPositionChange
          ];
          if (typeof handler === 'function') {
            (handler as (pos: { x: number; y: number }) => void)({
              x: newX,
              y: newY,
            });
          }
        }
      }
    },
    zoom,
    panX,
    panY,
    // 스마트 가이드 옵션
    elementId: element.fullId,
    elementWidth: element.measuredSize?.width || 100,
    elementHeight: element.measuredSize?.height || 100,
    getOtherElements: windowType === 'main' ? getOtherElements : null,
    // 선택 모드에서는 개별 드래그 비활성화
    disabled: isSelectionMode,
  });

  // 선택 요소 드래그 핸들러 (스마트 가이드 포함)
  const {
    handlePointerDown: handleSelectionDragPointerDown,
    movedDuringPressRef,
    pressMovedRef,
  } = useSelectionDrag({
    enabled: windowType === 'main' && isSelectionMode,
    zoom,
    startX: element.position.x,
    startY: element.position.y,
    elementId: element.fullId,
    elementWidth:
      element.measuredSize?.width ?? element.estimatedSize?.width ?? 200,
    elementHeight:
      element.measuredSize?.height ?? element.estimatedSize?.height ?? 150,
    selectedElements,
    getOtherElements,
    getSelectedElementIds: (selectedElement) => [selectedElement.id],
    onMultiDragStart,
    onMultiDrag,
    onMultiDragEnd,
  });

  const { ref: draggableRef, dx: renderX, dy: renderY } = draggable;

  // Shadow DOM 설정 (scoped 옵션)
  useEffect(() => {
    if (element.scoped && containerRef.current && !shadowRoot) {
      try {
        // 이미 shadowRoot가 있는지 확인
        if (containerRef.current.shadowRoot) {
          setShadowRoot(containerRef.current.shadowRoot);
        } else {
          const root = containerRef.current.attachShadow({
            mode: 'open',
          });
          setShadowRoot(root);
        }
      } catch {
        console.warn(
          `[PluginElement] Shadow DOM already attached for ${element.fullId}`,
        );
      }
    }
  }, [element.scoped, element.fullId, shadowRoot]);

  // 메인 창 한정 shadow tree 커서 정책 주입
  // 문서 규칙(.dmn-grabbable *)은 shadow 경계를 못 넘으므로 내부에서 상속을 강제
  useEffect(() => {
    if (windowType !== 'main' || !shadowRoot) return;
    if (shadowRoot.querySelector(`style[${SHADOW_CURSOR_STYLE_ATTR}]`)) return;
    const style = document.createElement('style');
    style.setAttribute(SHADOW_CURSOR_STYLE_ATTR, '');
    style.textContent = '* { cursor: inherit !important; }';
    shadowRoot.prepend(style);
  }, [windowType, shadowRoot]);

  // 템플릿 렌더링 결과 계산
  const renderedContent = (() => {
    if (definition && definition.template) {
      const state = element.state || {};
      const settings = element.settings || {};

      const renderState =
        windowType === 'main' && definition.previewState
          ? { ...state, ...definition.previewState }
          : state;

      try {
        return definition.template(renderState, settings, {
          html: html as unknown as DisplayElementTemplateHelpers['html'],
          styleMap,
          css,
          locale,
          t: pluginTranslate,
        });
      } catch (error) {
        console.error(`[PluginElement] Template render error:`, error);
        return null;
      }
    }
    return null;
  })();

  usePluginElementMeasurementRuntime({
    containerRef,
    shadowRoot,
    renderedContent,
    element,
    definition,
    windowType,
    zoom,
    updateElement,
  });

  usePluginElementOverlayRuntime({
    windowType,
    definition,
    element,
    updateElement,
    updateElementBatched,
    localeRef,
    pluginTranslateStable,
    settingsChangeListenersRef,
  });

  const elementStyle = buildPluginElementStyle({
    element,
    windowType,
    renderX,
    renderY,
    keyCount,
    arrayIndex,
    resizable: definition?.resizable === true,
  });
  const overlayHitStyle = buildPluginOverlayHitStyle(
    element,
    elementStyle,
    windowType,
  );

  const attachRef = (node: HTMLDivElement | null) => {
    containerRef.current = node;
    if (node) {
      // 선택 모드가 아닐 때만 드래그 ref 연결
      if (element.draggable && windowType === 'main' && !isSelectionMode) {
        draggableRef(node);
      }
    }
  };

  // onClick 핸들러
  const handleClick = (e: React.MouseEvent) => {
    // 우클릭은 컨텍스트 메뉴용이므로 제외
    if (e.button !== 0) return;

    // macOS ctrl+클릭은 우클릭 제스처 — Chromium이 contextmenu 뒤에 click도 발화
    if (isMac() && e.ctrlKey) return;

    // 드래그로 끝난 press의 trailing click은 클릭이 아니다 - 지우개 삭제·
    // 수식키 토글·범위 선택·선택+패널 열기로 새지 않게 흡수
    // (네이티브 요소와 동일 계약. 개별 드래그는 wasMoved, 선택 모드
    // 다중 드래그는 pressMovedRef가 판별)
    if (draggable.wasMoved || pressMovedRef.current) {
      e.stopPropagation();
      return;
    }

    if (windowType === 'main' && activeTool === 'eraser') {
      e.stopPropagation();
      deletePluginElement();
      return;
    }

    // Ctrl+클릭으로 선택 토글 (메인 윈도우에서만) - 선택 모드에서도 동작해야 함 (선택 해제용)
    const macOS = isMac();
    const isPrimaryModifierPressed = macOS ? e.metaKey : e.ctrlKey;

    if (isPrimaryModifierPressed && windowType === 'main') {
      e.stopPropagation();
      useGridSelectionStore.getState().toggleSelection({
        type: 'plugin',
        id: element.fullId,
      });
      // 마지막 선택 요소 좌표 저장
      if (element.measuredSize) {
        useGridSelectionStore.getState().setLastSelectedKeyBounds({
          x: element.position.x,
          y: element.position.y,
          width: element.measuredSize.width,
          height: element.measuredSize.height,
        });
      }
      return;
    }

    // Shift+클릭으로 범위 선택 (메인 윈도우에서만)
    if (e.shiftKey && windowType === 'main') {
      e.stopPropagation();
      const lastBounds = useGridSelectionStore.getState().lastSelectedKeyBounds;

      if (!lastBounds) {
        // 이전 선택이 없으면 단일 선택처럼 동작
        useGridSelectionStore.getState().selectElement({
          type: 'plugin',
          id: element.fullId,
        });
        if (element.measuredSize) {
          useGridSelectionStore.getState().setLastSelectedKeyBounds({
            x: element.position.x,
            y: element.position.y,
            width: element.measuredSize.width,
            height: element.measuredSize.height,
          });
        }
        return;
      }

      // 현재 클릭한 플러그인 요소의 bounds
      const clickedBounds = {
        x: element.position.x,
        y: element.position.y,
        width: element.measuredSize?.width || 100,
        height: element.measuredSize?.height || 100,
      };

      // 두 요소 사이의 사각형 영역 계산
      const minX = Math.min(lastBounds.x, clickedBounds.x);
      const maxX = Math.max(
        lastBounds.x + lastBounds.width,
        clickedBounds.x + clickedBounds.width,
      );
      const minY = Math.min(lastBounds.y, clickedBounds.y);
      const maxY = Math.max(
        lastBounds.y + lastBounds.height,
        clickedBounds.y + clickedBounds.height,
      );

      const rangeRect = {
        left: minX,
        top: minY,
        width: maxX - minX,
        height: maxY - minY,
      };

      // 범위 내 모든 요소 선택
      const newSelectedElements: SelectedElement[] = [];
      const { positions, selectedKeyType } = useKeyStore.getState();
      const pluginElements = usePluginDisplayElementStore.getState().elements;

      // 키 요소 체크
      positions[selectedKeyType]?.forEach((pos, i) => {
        const elementBounds = {
          x: pos.dx,
          y: pos.dy,
          width: pos.width || 60,
          height: pos.height || 60,
        };
        if (isElementInMarquee(elementBounds, rangeRect)) {
          newSelectedElements.push({
            type: 'key',
            id: pos.id,
            index: i,
          });
        }
      });

      // 플러그인 요소 체크
      pluginElements.forEach((el) => {
        const belongsToCurrentTab = !el.tabId || el.tabId === selectedKeyType;
        if (belongsToCurrentTab && el.measuredSize) {
          const elementBounds = {
            x: el.position.x,
            y: el.position.y,
            width: el.measuredSize.width,
            height: el.measuredSize.height,
          };
          if (isElementInMarquee(elementBounds, rangeRect)) {
            newSelectedElements.push({
              type: 'plugin',
              id: el.fullId,
            });
          }
        }
      });

      useGridSelectionStore.getState().setSelectedElements(newSelectedElements);
      return;
    }

    // 선택된 상태에서는 일반 클릭 흡수 (키와 동일 순서) —
    // 다중 선택 멤버 재클릭이 선택을 단일로 축소하지 않아야
    // 더블클릭의 "멤버면 선택 보존 + 배치 편집 진입" 정책이 성립한다
    if (isSelectionMode) {
      e.stopPropagation();
      return;
    }

    const settingsUI = definition?.settingsUI ?? 'panel';
    if (windowType === 'main' && settingsUI !== 'modal') {
      e.stopPropagation();
      // 그룹 멤버면 그룹 전체 선택 (native 클릭과 동일 의미론)
      useGridSelectionStore
        .getState()
        .setSelectedElements(
          expandGroupSelectionFromStores(
            { type: 'plugin', id: element.fullId },
            useKeyStore.getState().selectedKeyType,
          ),
        );
      // 마지막 선택 요소 좌표 저장
      if (element.measuredSize) {
        useGridSelectionStore.getState().setLastSelectedKeyBounds({
          x: element.position.x,
          y: element.position.y,
          width: element.measuredSize.width,
          height: element.measuredSize.height,
        });
      }
      return;
    }

    // onClick 핸들러가 있고, 메인 윈도우에서만
    if (!element.onClick || windowType !== 'main') return;

    // onClick 핸들러 실행 (자동 래핑되어 있음)
    if (typeof element.onClick === 'string') {
      const handler = (window as unknown as Record<string, unknown>)[
        element.onClick
      ];
      if (typeof handler === 'function') {
        (handler as (e: React.MouseEvent) => void)(e);
      }
    }
  };

  // 더블클릭 편집 진입 — 순수 더블클릭만 통과 (드래그·수식키·지우개·뷰포트 변환 제외).
  // 다중 선택의 멤버면 선택을 보존해 배치 편집으로, 아니면 이 요소만 선택.
  // settingsUI가 modal인 플러그인은 클릭 선택 자체가 없으므로 제외
  const handleDoubleClick = (e: React.MouseEvent) => {
    if (windowType !== 'main') return;
    if ((definition?.settingsUI ?? 'panel') === 'modal') return;
    if (isMac() && e.ctrlKey) return;
    if (e.shiftKey || e.metaKey || e.ctrlKey) return;
    if (activeTool === 'eraser') return;
    if (isViewportTransforming) return;
    if (draggable.recentPressMovedRef.current || movedDuringPressRef.current)
      return;
    e.stopPropagation();

    const { selectedElements: currentSelection } =
      useGridSelectionStore.getState();
    const isMultiMember =
      currentSelection.length > 1 &&
      currentSelection.some((el) => el.id === element.fullId);
    if (!isMultiMember) {
      // native 더블클릭과 동일하게 그룹 멤버 전체 선택 후 편집 진입
      useGridSelectionStore
        .getState()
        .setSelectedElements(
          expandGroupSelectionFromStores(
            { type: 'plugin', id: element.fullId },
            useKeyStore.getState().selectedKeyType,
          ),
        );
    }
    openPropertiesPanelForSelection();
  };

  // 문자열 템플릿(레거시) __html 래퍼를 값 기준으로 고정.
  // React 19는 {__html} 객체 identity가 바뀌면 내용이 같아도 innerHTML을 다시 설정해
  // 내부 노드를 전부 교체한다 - 프레스 중 재렌더(isDragging 등)가 클릭 대상 노드를
  // detach시켜 브라우저가 click 디스패치를 포기하고 선택 클릭이 유실되는 것을 차단
  const legacyHtml = renderedContent
    ? typeof renderedContent === 'string'
      ? renderedContent
      : null
    : element.html || null;
  const legacyHtmlProp = useMemo(
    () => (legacyHtml === null ? null : { __html: legacyHtml }),
    [legacyHtml],
  );

  // 렌더링 로직
  const renderContent = (): React.ReactNode => {
    if (renderedContent) {
      // 템플릿 결과가 문자열인 경우 (레거시)
      if (legacyHtmlProp) {
        return <div dangerouslySetInnerHTML={legacyHtmlProp} />;
      }
      // React Element인 경우 (DisplayElementTemplateResult -> ReactNode)
      return renderedContent as unknown as React.ReactNode;
    }

    // 템플릿이 없고 html 속성만 있는 경우 (레거시)
    if (legacyHtmlProp) {
      return <div dangerouslySetInnerHTML={legacyHtmlProp} />;
    }

    return null;
  };

  return (
    <>
      {overlayHitStyle ? (
        <div
          aria-hidden="true"
          style={overlayHitStyle}
          data-overlay-hit="true"
          data-plugin-hit-box={element.fullId}
        />
      ) : null}
      <div
        ref={attachRef}
        id={element.id}
        className={`${windowType === 'main' ? 'dmn-grabbable' : ''} ${
          element.className || ''
        }`}
        style={elementStyle}
        data-plugin-element={element.fullId}
        data-plugin-id={element.pluginId}
        data-editing={isDraggingOrResizing ? 'true' : undefined}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onPointerDown={
          windowType === 'main' && isSelectionMode
            ? handleSelectionDragPointerDown
            : undefined
        }
        onContextMenu={handleContextMenu}
      >
        {element.scoped && shadowRoot
          ? createPortal(renderContent(), shadowRoot as unknown as Element)
          : renderContent()}
      </div>

      {contextMenu}
    </>
  );
};

// 요소 하나의 갱신이 나머지 전체 리렌더로 번지지 않도록 차단
// (스토어 update 경로는 미변경 요소의 참조를 유지하므로 shallow 비교로 스킵됨)
export const PluginElement = React.memo(PluginElementImpl);
