import React, { useRef, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { isMac } from '@utils/core/platform';
import { slotCanonical } from '@utils/keySlot';
import {
  PluginDisplayElementInternal,
  ElementResizeAnchor,
  DisplayElementTemplateHelpers,
} from '@src/types/plugin/api';
import { useDraggable } from '@hooks/Grid';
import { usePopupPresence } from '@hooks/ui/usePopupPresence';
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
import ListPopup, { ListItem } from '../main/Modal/ListPopup';
import { html, styleMap, css } from '@utils/core/templateEngine';
import { translatePluginMessage } from '@utils/plugin/pluginI18n';
import {
  registerExposedActions,
  clearExposedActions,
} from '@utils/displayElementActions';
import { setupPluginDropdownInteractions } from '@utils/plugin/pluginDropdownManager';
import { createPluginHandlerDispatcher } from '@utils/plugin/pluginHandlerDispatcher';
import { sendBridgeMessageBestEffort } from '@utils/plugin/bridgeMessages';
import { obsApi } from '@api/modules/obsApi';
import { evaluatePluginMenuItems } from '@utils/plugin/pluginElementContextMenu';
import {
  getPluginMenuRuntimeState,
  normalizeStateKeys,
} from '@utils/plugin/pluginMenuRuntimeState';
import {
  measureConnectedPluginElement,
  resolveResizablePluginElementSize,
} from '@utils/plugin/pluginElementMeasurement';
import {
  beginPluginInstancesEditSession,
  endPluginInstancesEditSession,
} from '@plugins/runtime/displayElement/instancesCommitQueue';
import { commitStableLayerZOrder } from '@src/renderer/editor/runtime/layerZOrderIntent';
import { reportElementOpError } from '@src/renderer/editor/runtime/elementIntent';
import { expandGroupSelectionFromStores } from '@utils/grid/groupSelection';

const DEFAULT_POSITION_OFFSET = { x: 0, y: 0 };
const EMPTY_SELECTED_ELEMENTS: SelectedElement[] = [];
// scoped 플러그인 shadow tree에 주입되는 커서 정책 스타일 식별자
const SHADOW_CURSOR_STYLE_ATTR = 'data-dmn-cursor-policy';

/**
 * 리사이즈 앵커에 따라 크기 변경 시 위치 보정값 계산
 */
function calculateAnchorOffset(
  anchor: ElementResizeAnchor,
  prevSize: { width: number; height: number },
  newSize: { width: number; height: number },
): { dx: number; dy: number } {
  const dw = newSize.width - prevSize.width;
  const dh = newSize.height - prevSize.height;

  let dx = 0;
  let dy = 0;

  // X축 보정 (center, right 계열)
  if (anchor.includes('center') && !anchor.startsWith('center')) {
    // top-center, bottom-center
    dx = -dw / 2;
  } else if (anchor === 'center') {
    dx = -dw / 2;
  } else if (anchor.includes('right')) {
    dx = -dw;
  } else if (anchor === 'center-left') {
    dx = 0;
  } else if (anchor === 'center-right') {
    dx = -dw;
  }

  // Y축 보정 (center, bottom 계열)
  if (anchor.startsWith('center')) {
    // center-left, center, center-right
    dy = -dh / 2;
  } else if (anchor.startsWith('bottom')) {
    dy = -dh;
  }

  return { dx, dy };
}

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

  // 이전 크기를 추적하여 리사이즈 앵커 기반 위치 보정에 사용
  // 초기값으로 element.measuredSize를 사용하여 리로드 후에도 올바르게 동작
  const prevMeasuredSizeRef = useRef<{ width: number; height: number } | null>(
    element.measuredSize ? { ...element.measuredSize } : null,
  );

  // 이전 앵커를 추적하여 앵커 변경 시 prevMeasuredSizeRef 리셋
  const prevAnchorRef = useRef<string | undefined>(
    element.resizeAnchor || definition?.resizeAnchor || 'top-left',
  );

  // 이전 줌 값을 추적하여 줌 변경 시 위치 보정을 스킵
  const prevZoomRef = useRef<number>(zoom);

  // 앵커가 변경되면 prevMeasuredSizeRef를 현재 크기로 리셋
  // 이렇게 하면 앵커 변경 직후의 크기 변화에서 불필요한 위치 보정이 발생하지 않음
  useEffect(() => {
    const currentAnchor =
      element.resizeAnchor || definition?.resizeAnchor || 'top-left';
    if (prevAnchorRef.current !== currentAnchor) {
      // 앵커가 변경됨 - 현재 측정된 크기로 리셋
      if (element.measuredSize) {
        prevMeasuredSizeRef.current = { ...element.measuredSize };
      }
      prevAnchorRef.current = currentAnchor;
    }
  }, [element.resizeAnchor, definition?.resizeAnchor, element.measuredSize]);

  // element.measuredSize가 외부에서 변경될 때(리사이즈 등) userPreservedSizeRef 업데이트
  // 단, needsRemeasure 상태가 아닐 때만 (설정 변경으로 인한 재측정 중에는 스킵)
  useEffect(() => {
    if (
      windowType === 'main' &&
      definition?.resizable &&
      element.measuredSize &&
      !needsRemeasureRef.current
    ) {
      userPreservedSizeRef.current = { ...element.measuredSize };
    }
  }, [windowType, definition?.resizable, element.measuredSize]);

  useEffect(() => {
    localeRef.current = locale;
  }, [locale]);

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

  const positions = useKeyStore((state) => state.positions);
  const selectedKeyType = useKeyStore((state) => state.selectedKeyType);
  const exposedActionsRef = useRef<
    Record<string, (...args: unknown[]) => unknown>
  >({});
  // 컨텍스트 메뉴 predicate 예외는 요소·항목당 1회만 기록
  const menuPredicateErrorRef = useRef(new Set<string>());

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

  // Settings 변경 시 measuredSize 리셋 (main 윈도우, resizable 요소만)
  // 설정 변경으로 UI가 변할 수 있으므로 새로 측정하도록 함
  const prevSettingsForResizeRef = useRef<Record<string, unknown> | null>(null);
  // 설정 변경으로 재측정이 필요한 상태인지 플래그
  const needsRemeasureRef = useRef(false);
  // 사용자가 설정한(또는 초기 측정된) preserveAxis 축의 크기
  // 이 값은 리사이즈나 초기 측정 시에만 업데이트되고, 설정 변경 시에는 유지됨
  const userPreservedSizeRef = useRef<{
    width: number;
    height: number;
  } | null>(null);
  // 설정별 크기 히스토리 (설정 JSON -> 크기 매핑)
  const settingsSizeHistoryRef = useRef<
    Map<string, { width: number; height: number }>
  >(new Map());

  useEffect(() => {
    if (windowType !== 'main') return;
    if (!definition?.resizable) return;

    const currentSettings = element.settings || {};
    const prevSettings = prevSettingsForResizeRef.current;

    // 최초 마운트 시에는 이전 설정 저장만
    if (prevSettings === null) {
      prevSettingsForResizeRef.current = { ...currentSettings };
      // 초기 설정에 대한 크기 저장
      if (element.measuredSize) {
        const settingsKey = JSON.stringify(currentSettings);
        settingsSizeHistoryRef.current.set(settingsKey, {
          ...element.measuredSize,
        });
      }
      return;
    }

    // 설정이 실제로 변경되었는지 확인 (JSON 문자열 비교)
    const currentStr = JSON.stringify(currentSettings);
    const prevStr = JSON.stringify(prevSettings);
    const hasChanged = currentStr !== prevStr;

    if (hasChanged) {
      // 이전 설정에 대한 현재 크기 저장 (나중에 복원용)
      if (element.measuredSize) {
        settingsSizeHistoryRef.current.set(prevStr, {
          ...element.measuredSize,
        });
      }

      // 현재 설정에 대해 저장된 크기가 있으면 복원, 없으면 재측정
      const savedSize = settingsSizeHistoryRef.current.get(currentStr);
      if (savedSize) {
        // 저장된 크기로 즉시 복원 (width, height도 함께 업데이트)
        const currentSize = element.measuredSize;
        const resizeAnchor: ElementResizeAnchor =
          element.resizeAnchor || definition?.resizeAnchor || 'top-left';

        // 앵커 기반 위치 보정 계산
        let newPosition = element.position;
        if (currentSize && resizeAnchor !== 'top-left') {
          const { dx, dy } = calculateAnchorOffset(
            resizeAnchor,
            currentSize,
            savedSize,
          );
          if (dx !== 0 || dy !== 0) {
            newPosition = {
              x: element.position.x + dx,
              y: element.position.y + dy,
            };
          }
        }

        updateElement(element.fullId, {
          measuredSize: savedSize,
          width: savedSize.width,
          height: savedSize.height,
          position: newPosition,
        });
        prevMeasuredSizeRef.current = savedSize;
      } else {
        // 재측정 필요 플래그 설정
        needsRemeasureRef.current = true;
      }

      // 이전 설정 업데이트
      prevSettingsForResizeRef.current = { ...currentSettings };
    }
  }, [
    windowType,
    definition?.resizable,
    definition?.resizeAnchor,
    element.settings,
    element.fullId,
    element.measuredSize,
    element.position,
    element.resizeAnchor,
    updateElement,
  ]);

  // 컨텍스트 메뉴 상태
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({
    x: 0,
    y: 0,
  });
  // 열림 시점 커스텀 항목 동결. 열림 중 플러그인이 customItems를 교체해도
  // 표시와 index 디스패치가 같은 배열을 본다
  const frozenCustomItemsRef =
    useRef<
      NonNullable<PluginDisplayElementInternal['contextMenu']>['customItems']
    >(undefined);

  // 앵커 기반 위치 계산
  const calculatedPosition = (() => {
    let baseX = element.position.x;
    let baseY = element.position.y;

    // 앵커가 있으면 키 위치 기반으로 계산
    if (element.anchor?.keyCode && positions && selectedKeyType) {
      const keyMappings = useKeyStore.getState().keyMappings;
      const modeKeys = keyMappings[selectedKeyType] || [];
      // 앵커 keyCode는 canonical 문자열 (멀티 슬롯 포함 매칭)
      const keyIndex = modeKeys.findIndex(
        (key) => slotCanonical(key) === element.anchor?.keyCode,
      );

      if (keyIndex >= 0 && positions[selectedKeyType]?.[keyIndex]) {
        const keyPosition = positions[selectedKeyType][keyIndex];
        const offsetX = element.anchor.offset?.x ?? 0;
        const offsetY = element.anchor.offset?.y ?? 0;

        baseX = keyPosition.dx + offsetX;
        baseY = keyPosition.dy + offsetY;
      }
    }

    // 오버레이에서는 positionOffset 적용
    return {
      x: baseX + positionOffset.x,
      y: baseY + positionOffset.y,
    };
  })();

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

  // 이벤트 위임 (메인 윈도우에서만)
  useEffect(() => {
    const target = element.scoped ? shadowRoot : containerRef.current;
    if (!target) return;

    let measurementFrame: number | null = null;

    // 메인 윈도우에서만 실제 크기 측정 후 store 업데이트
    // resizable인 경우: 이미 measuredSize가 있고 재측정이 필요하지 않으면 스킵
    const isResizableWithSize =
      definition?.resizable &&
      element.measuredSize &&
      !needsRemeasureRef.current;

    if (windowType === 'main' && containerRef.current && !isResizableWithSize) {
      const measurementTarget = containerRef.current;
      measurementFrame = requestAnimationFrame(() => {
        measurementFrame = null;
        if (containerRef.current === measurementTarget) {
          // 재측정이 필요한 경우, 일시적으로 크기 제약을 풀어 자연스러운 콘텐츠 크기 측정
          const needsRemeasure =
            needsRemeasureRef.current && definition?.resizable;
          const preserveAxis = definition?.preserveAxis || 'both';

          let originalWidth = '';
          let originalHeight = '';

          if (needsRemeasure) {
            originalWidth = containerRef.current.style.width;
            originalHeight = containerRef.current.style.height;

            // preserveAxis에 따라 해제할 축 결정
            if (preserveAxis !== 'width' && preserveAxis !== 'both') {
              containerRef.current.style.width = 'auto';
            }
            if (preserveAxis !== 'height' && preserveAxis !== 'both') {
              containerRef.current.style.height = 'auto';
            }
          }

          const measuredSize = measureConnectedPluginElement(
            measurementTarget,
            zoom,
          );

          // 스타일 복원
          if (needsRemeasure) {
            containerRef.current.style.width = originalWidth;
            containerRef.current.style.height = originalHeight;
          }

          if (!measuredSize) return;

          const measuredWidth = measuredSize.width;
          const measuredHeight = measuredSize.height;

          // 설정 변경으로 인한 재측정인 경우, preserveAxis에 해당하는 축은 유지
          let finalWidth = measuredWidth;
          let finalHeight = measuredHeight;
          const userPreservedSize = userPreservedSizeRef.current;

          if (definition?.resizable && needsRemeasureRef.current) {
            // preserveAxis에 따라 각 축 유지 여부 결정
            const shouldPreserveWidth =
              preserveAxis === 'width' || preserveAxis === 'both';
            const shouldPreserveHeight =
              preserveAxis === 'height' || preserveAxis === 'both';

            // 가로: 유지 설정이고 저장된 값이 있으면 그 값 사용
            if (shouldPreserveWidth && userPreservedSize) {
              finalWidth = userPreservedSize.width;
            }
            // 세로: 유지 설정이고 저장된 값이 있으면 그 값 사용
            if (shouldPreserveHeight && userPreservedSize) {
              finalHeight = userPreservedSize.height;
            }
            needsRemeasureRef.current = false;
          }

          // 초기 측정 시 또는 콘텐츠가 커진 경우 userPreservedSizeRef 업데이트
          if (!userPreservedSize) {
            userPreservedSizeRef.current = {
              width: finalWidth,
              height: finalHeight,
            };
          }

          const newSize = { width: finalWidth, height: finalHeight };

          // 줌이 변경되었는지 확인
          const zoomChanged = prevZoomRef.current !== zoom;
          prevZoomRef.current = zoom;

          // 현재 크기와 이전 크기 비교
          const prevSize = prevMeasuredSizeRef.current;
          const sizeChanged =
            !element.measuredSize ||
            element.measuredSize.width !== finalWidth ||
            element.measuredSize.height !== finalHeight;

          if (sizeChanged) {
            // 리사이즈 앵커 결정 (우선순위: element > definition > default)
            const resizeAnchor: ElementResizeAnchor =
              element.resizeAnchor || definition?.resizeAnchor || 'top-left';

            // 줌 변경으로 인한 크기 측정 차이는 위치 보정하지 않음
            // 실제 콘텐츠 변화에 의한 크기 변경만 위치 보정
            const shouldAdjustPosition =
              prevSize && resizeAnchor !== 'top-left' && !zoomChanged;

            if (shouldAdjustPosition) {
              const { dx, dy } = calculateAnchorOffset(
                resizeAnchor,
                prevSize,
                newSize,
              );

              if (dx !== 0 || dy !== 0) {
                // 위치와 크기를 함께 업데이트
                updateElement(element.fullId, {
                  position: {
                    x: element.position.x + dx,
                    y: element.position.y + dy,
                  },
                  measuredSize: newSize,
                });
              } else {
                updateElement(element.fullId, {
                  measuredSize: newSize,
                });
              }
            } else {
              // 첫 측정이거나 top-left 앵커이거나 줌 변경인 경우 크기만 업데이트
              updateElement(element.fullId, {
                measuredSize: newSize,
              });
            }

            // 이전 크기 저장
            prevMeasuredSizeRef.current = newSize;
          }
        }
      });
    }

    // data-plugin-handler 이벤트 위임 (메인 윈도우에서만)
    if (windowType === 'main') {
      const dispatcher = createPluginHandlerDispatcher();
      // Input blur 핸들러: min/max 자동 정규화
      const handleInputBlur = (e: Event) => {
        const targetEl = e.target as HTMLInputElement;
        if (
          targetEl.tagName === 'INPUT' &&
          targetEl.type === 'number' &&
          targetEl.hasAttribute('data-plugin-input-blur')
        ) {
          const minStr = targetEl.getAttribute('data-plugin-input-min');
          const maxStr = targetEl.getAttribute('data-plugin-input-max');
          const currentValue = targetEl.value;

          // 빈 값이거나 숫자가 아닌 경우
          if (currentValue === '' || isNaN(parseFloat(currentValue))) {
            // min이 있으면 min으로, 없으면 0으로
            const defaultValue = minStr ? parseFloat(minStr) : 0;
            targetEl.value = String(defaultValue);
            // change 이벤트 발생
            targetEl.dispatchEvent(new Event('change', { bubbles: true }));
            return;
          }

          const numValue = parseFloat(currentValue);
          let clampedValue = numValue;

          // min/max 범위로 제한
          if (minStr && numValue < parseFloat(minStr)) {
            clampedValue = parseFloat(minStr);
          }
          if (maxStr && numValue > parseFloat(maxStr)) {
            clampedValue = parseFloat(maxStr);
          }

          // 값이 변경되었으면 업데이트
          if (clampedValue !== numValue) {
            targetEl.value = String(clampedValue);
            // change 이벤트 발생
            targetEl.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      };

      // 체크박스 토글 기능
      const handleCheckboxToggle = (e: Event) => {
        const targetEl = e.target as HTMLElement;
        const checkbox = targetEl.closest('[data-checkbox-toggle]');
        if (checkbox) {
          // label 기본 동작(input으로의 합성 클릭 재토글) 차단 — 수동 토글만 커밋
          e.preventDefault();
          const input = checkbox.querySelector(
            'input[type=checkbox]',
          ) as HTMLInputElement;
          const knob = checkbox.querySelector('div') as HTMLElement;

          if (input) {
            input.checked = !input.checked;

            // 스타일 토글 — createCheckbox의 액센트 토큰과 동기
            if (input.checked) {
              checkbox.classList.remove('bg-line-strong');
              checkbox.classList.add('bg-accent');
              knob.classList.remove('left-[2px]');
              knob.classList.add('left-[14px]');
            } else {
              checkbox.classList.remove('bg-accent');
              checkbox.classList.add('bg-line-strong');
              knob.classList.remove('left-[14px]');
              knob.classList.add('left-[2px]');
            }

            // change 이벤트 발생
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      };

      const handleEvent = (e: Event) => {
        const targetEl = e.target as HTMLElement;
        const handlerAttr =
          e.type === 'click'
            ? 'data-plugin-handler'
            : e.type === 'input'
            ? 'data-plugin-handler-input'
            : e.type === 'change'
            ? 'data-plugin-handler-change'
            : null;

        if (!handlerAttr) return;

        // 클릭/변경된 요소 또는 부모에서 핸들러 찾기
        let currentElement: HTMLElement | null = targetEl;
        let handlerName: string | null = null;

        while (currentElement && currentElement !== target) {
          handlerName = currentElement.getAttribute(handlerAttr);
          if (handlerName) break;
          currentElement = currentElement.parentElement;
        }

        if (!handlerName) return;

        // 핸들러 실행 (자동 래핑되어 있음)
        const handler = (window as unknown as Record<string, unknown>)[
          handlerName
        ];
        if (typeof handler === 'function' && currentElement) {
          dispatcher.dispatch(
            currentElement,
            handler as (event: Event) => unknown,
            e,
          );
        }
      };

      const detachDropdowns = setupPluginDropdownInteractions(target);

      target.addEventListener('click', handleCheckboxToggle);
      target.addEventListener('click', handleEvent);
      target.addEventListener('change', handleEvent);
      target.addEventListener('input', handleEvent);
      target.addEventListener('blur', handleInputBlur, true); // capture 단계

      // 정리
      return () => {
        dispatcher.cleanup();
        if (measurementFrame !== null) {
          cancelAnimationFrame(measurementFrame);
        }
        target.removeEventListener('click', handleCheckboxToggle);
        target.removeEventListener('click', handleEvent);
        target.removeEventListener('change', handleEvent);
        target.removeEventListener('input', handleEvent);
        target.removeEventListener('blur', handleInputBlur, true);
        detachDropdowns();
      };
    }

    return undefined;
  }, [
    element.scoped,
    element.fullId,
    element.position,
    element.resizeAnchor,
    updateElement,
    windowType,
    shadowRoot,
    renderedContent, // 컨텐츠 변경 시 크기 재측정
    zoom,
    definition?.preserveAxis,
    definition?.resizable,
    definition?.resizeAnchor,
    element.measuredSize,
  ]);

  // Overlay 로직 (onMount)
  useEffect(() => {
    if (windowType !== 'overlay') return;

    if (!definition) {
      // definition이 아직 로드되지 않았을 수 있음.
      // definitions가 업데이트되면 리렌더링되므로 그때 다시 시도됨.
      return;
    }

    if (!definition.onMount) return;

    // 이전 expose 액션 초기화
    exposedActionsRef.current = {};
    clearExposedActions(element.fullId);

    const cleanups: (() => void)[] = [];

    // 메뉴 predicate용 선언 키(contextMenuStateKeys) 동기화 —
    // 스토어는 rAF 배치라 동기 shadow에서 diff를 계산해 변경분만 송신
    const menuStateKeys = normalizeStateKeys(definition.contextMenuStateKeys);
    const latestState: Record<string, unknown> = {
      ...(usePluginDisplayElementStore
        .getState()
        .elements.find((el) => el.fullId === element.fullId)?.state ?? {}),
    };
    const lastSentMenuState: Record<string, unknown> = {};
    const sendMenuStateSync = () => {
      if (menuStateKeys.length === 0) return;
      const changed: Record<string, unknown> = {};
      for (const key of menuStateKeys) {
        if (!Object.prototype.hasOwnProperty.call(latestState, key)) continue;
        const value = latestState[key];
        if (
          Object.prototype.hasOwnProperty.call(lastSentMenuState, key) &&
          Object.is(lastSentMenuState[key], value)
        ) {
          continue;
        }
        changed[key] = value;
        lastSentMenuState[key] = value;
      }
      if (Object.keys(changed).length === 0) return;
      sendBridgeMessageBestEffort(
        'main',
        'plugin:displayElement:syncMenuState',
        { fullId: element.fullId, state: changed },
      );
    };

    // OBS WS 재연결 시 단절 중 유실됐을 수 있는 제어 상태 재송신
    if (menuStateKeys.length > 0) {
      const unsubMenuStateResync = obsApi.onResync(() => {
        Object.keys(lastSentMenuState).forEach((key) => {
          delete lastSentMenuState[key];
        });
        sendMenuStateSync();
      });
      cleanups.push(unsubMenuStateResync);
    }

    const context = {
      setState: (updates: Record<string, unknown>) => {
        Object.assign(latestState, updates);
        // rAF 기반 배치 업데이트 사용 (성능 최적화)
        const currentElement = usePluginDisplayElementStore
          .getState()
          .elements.find((el) => el.fullId === element.fullId);
        if (currentElement) {
          updateElementBatched(element.fullId, {
            state: { ...currentElement.state, ...updates },
          });
        }
        sendMenuStateSync();
      },
      getSettings: () => {
        const currentElement = usePluginDisplayElementStore
          .getState()
          .elements.find((el) => el.fullId === element.fullId);
        return currentElement?.settings || {};
      },
      setAnchor: (anchor: ElementResizeAnchor) => {
        // 오버레이 로컬 스토어 업데이트
        updateElement(element.fullId, { resizeAnchor: anchor });
        // 메인 윈도우로 동기화 (브릿지 통해)
        sendBridgeMessageBestEffort(
          'main',
          'plugin:displayElement:updateAnchor',
          {
            fullId: element.fullId,
            resizeAnchor: anchor,
          },
        );
      },
      getAnchor: (): ElementResizeAnchor => {
        const currentElement = usePluginDisplayElementStore
          .getState()
          .elements.find((el) => el.fullId === element.fullId);
        return (
          currentElement?.resizeAnchor || definition?.resizeAnchor || 'top-left'
        );
      },
      onHook: (event: string, callback: (...args: unknown[]) => void) => {
        // console.log(`[PluginElement] onHook registered for ${event}`);
        if (event === 'key') {
          // 백엔드 재구독 대신 키 이벤트 버스 사용
          import('@utils/core/keyEventBus').then(({ keyEventBus }) => {
            const unsub = keyEventBus.subscribe((payload) => {
              // console.log(`[PluginElement] Key event received via hook`, payload);
              callback(payload);
            });
            cleanups.push(unsub);
          });
        } else if (event === 'rawKey') {
          // Raw key 이벤트 버스 사용 (구독 기반 - 구독자가 있을 때만 백엔드가 emit)
          import('@utils/core/rawKeyEventBus').then(({ rawKeyEventBus }) => {
            rawKeyEventBus
              .subscribe((payload) => {
                callback(payload);
              })
              .then((unsub) => {
                cleanups.push(unsub);
              })
              .catch((error) => {
                console.error(
                  `[PluginElement] Failed to subscribe to rawKey:`,
                  error,
                );
              });
          });
        }
      },
      expose: (actions: Record<string, (...args: unknown[]) => unknown>) => {
        if (!actions || typeof actions !== 'object') return;
        const validEntries = Object.entries(actions).filter(
          ([, fn]) => typeof fn === 'function',
        );
        if (validEntries.length === 0) return;

        exposedActionsRef.current = {
          ...exposedActionsRef.current,
          ...Object.fromEntries(validEntries),
        };
        registerExposedActions(element.fullId, exposedActionsRef.current);
      },
      locale: localeRef.current,
      t: pluginTranslateStable,
      onLocaleChange: (listener: (locale: string) => void) => {
        if (window.api?.i18n?.onLocaleChange) {
          return window.api.i18n.onLocaleChange(listener);
        }
        console.warn(
          '[PluginElement] i18n API is not available in this context',
        );
        return () => undefined;
      },
      onSettingsChange: (
        listener: (
          newSettings: Record<string, unknown>,
          oldSettings: Record<string, unknown>,
        ) => void,
      ) => {
        settingsChangeListenersRef.current.add(listener);
        cleanups.push(() => {
          settingsChangeListenersRef.current.delete(listener);
        });
      },
    };

    console.warn(`[PluginElement] Mounting ${element.fullId}`);

    const mountCleanup = definition.onMount(context);
    if (typeof mountCleanup === 'function') {
      cleanups.push(mountCleanup);
    }

    // 동기 onMount 완료 후 초기 1회 송신 — 이미 setState로 보낸 키는 dedup됨
    sendMenuStateSync();

    return () => {
      clearExposedActions(element.fullId);
      exposedActionsRef.current = {};
      cleanups.forEach((fn) => fn());
    };
  }, [windowType, definition?.id, element.fullId, updateElementBatched]); // eslint-disable-line react-hooks/exhaustive-deps

  const elementStyle: React.CSSProperties = (() => {
    // 그리드 안 승격 금지 - WebKit은 합성 자식이 생기면 스케일 컨테이너를
    // 레이어로 만들어 전체가 흐려진다. 오버레이 창은 스케일 조상이 없어 유지
    const shouldPromoteTransformLayer = windowType === 'overlay';

    const baseStyle: React.CSSProperties = {
      position: 'absolute',
      left: 0,
      top: 0,
      transform:
        windowType === 'main'
          ? `translate(${renderX}px, ${renderY}px)`
          : `translate3d(${renderX}px, ${renderY}px, 0)`,
      // 명시적인 zIndex가 있으면 사용, 없으면 키 개수 + 배열 인덱스로 계산
      // 키들 뒤에 순서대로 배치되어 통합 z-order 동작
      zIndex: element.zIndex ?? keyCount + arrayIndex,
      // 커서는 dmn-grabbable 클래스가 소유 (호버 무변화, 잡는 동안만 grabbing)
      cursor: windowType === 'main' ? undefined : 'default',
      willChange: shouldPromoteTransformLayer ? 'transform' : 'auto',
      pointerEvents: windowType === 'main' ? 'auto' : 'none',
    };

    // resizable 요소는 첫 측정 전에도 부모 크기를 제공
    if (definition?.resizable) {
      const renderSize = resolveResizablePluginElementSize(element);
      baseStyle.width = renderSize.width;
      baseStyle.height = renderSize.height;
      baseStyle.overflow = 'hidden';
    }

    return { ...baseStyle, ...element.style };
  })();

  const attachRef = (node: HTMLDivElement | null) => {
    containerRef.current = node;
    if (node) {
      // 선택 모드가 아닐 때만 드래그 ref 연결
      if (element.draggable && windowType === 'main' && !isSelectionMode) {
        draggableRef(node);
      }
    }
  };

  // 컨텍스트 메뉴 핸들러
  const handleContextMenu = (e: React.MouseEvent) => {
    // 오버레이에서는 기본 브라우저 메뉴만 차단
    if (windowType !== 'main') {
      e.preventDefault();
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const handledBySelectionMenu =
      onSelectionContextMenu?.({
        elementId: element.fullId,
        clientX: e.clientX,
        clientY: e.clientY,
        referenceElement: containerRef.current,
      }) === true;
    if (handledBySelectionMenu) return;

    // 플러그인 요소 우클릭은 그리드 우클릭으로 전파하지 않음
    // (contextMenu 설정이 없으면 메뉴만 열지 않고 종료)
    if (!element.contextMenu) return;

    // 열림 시점 항목 동결 - 열림 중 교체가 index 디스패치를 어긋내지 않게
    frozenCustomItemsRef.current = element.contextMenu.customItems ?? [];
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
    setContextMenuOpen(true);
  };

  const deleteInFlightRef = useRef(false);
  const observePluginAction = (result: unknown, label: string) => {
    if (
      typeof result === 'object' &&
      result !== null &&
      'then' in result &&
      typeof result.then === 'function'
    ) {
      void Promise.resolve(result).catch((error) =>
        console.error(`[PluginElement] ${label} failed`, error),
      );
    }
  };

  const deletePluginElement = () => {
    if (deleteInFlightRef.current) return;
    deleteInFlightRef.current = true;
    // onDelete 핸들러 호출 (자동 래핑되어 있음)
    try {
      if (element.onDelete && typeof element.onDelete === 'string') {
        const handler = (window as unknown as Record<string, unknown>)[
          element.onDelete
        ];
        if (typeof handler === 'function') {
          observePluginAction(handler(), 'onDelete');
        }
      }
    } catch (error) {
      console.error('[PluginElement] onDelete failed', error);
    }
    try {
      if (window.api?.ui?.displayElement) {
        window.api.ui.displayElement.remove(element.fullId);
      } else {
        usePluginDisplayElementStore.getState().removeElement(element.fullId);
      }
    } catch (error) {
      deleteInFlightRef.current = false;
      console.error('[PluginElement] remove failed', error);
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

  const createActionsProxy = (elementId: string) =>
    new Proxy(
      {},
      {
        get: (_target, prop: string | symbol) => {
          if (typeof prop !== 'string') return undefined;
          return (...args: unknown[]) => {
            sendBridgeMessageBestEffort(
              'overlay',
              'plugin:displayElement:invokeAction',
              {
                elementId,
                action: prop,
                args,
              },
            );
          };
        },
      },
    );

  // 컨텍스트 메뉴 항목 생성 - 마운트된 동안만 커스텀 predicate 평가
  // 퇴장 모션이 도는 동안 메뉴 DOM을 유지한다. 열림 판정 자체는 그대로 두고
  // 마운트 게이트만 늘려 상시 마운트로 번지는 걸 막는다
  const contextMenuPresence = usePopupPresence(contextMenuOpen);

  const contextMenuItems: ListItem[] = (() => {
    // 닫히는 중에도 항목을 유지해야 잔상이 빈 메뉴로 보이지 않는다
    if (!contextMenuPresence.mounted || !element.contextMenu) return [];

    const { enableDelete = true, deleteLabel = '삭제' } = element.contextMenu;
    // 동결 참조 우선 - 표시 항목과 클릭 디스패치가 같은 배열에서 나온다
    const customItems =
      frozenCustomItemsRef.current ?? element.contextMenu.customItems ?? [];

    // predicate가 보는 element.state에는 contextMenuStateKeys로 선언된
    // 오버레이 런타임 값만 병합 — 프리뷰용 state 자체는 불변
    const menuStateKeys = normalizeStateKeys(definition?.contextMenuStateKeys);
    const menuElement =
      menuStateKeys.length > 0
        ? {
            ...element,
            state: {
              ...element.state,
              ...getPluginMenuRuntimeState(element.fullId, menuStateKeys),
            },
          }
        : element;

    // visible/disabled/position 계약 이행 (grid/key 메뉴와 동일 의미)
    const { top, bottom } = evaluatePluginMenuItems(
      customItems,
      { element: menuElement, actions: createActionsProxy(element.fullId) },
      (label) => pluginTranslate(label, undefined, label),
      (index, kind, error) => {
        const errorKey = `${element.fullId}:${index}:${kind}`;
        if (menuPredicateErrorRef.current.has(errorKey)) return;
        menuPredicateErrorRef.current.add(errorKey);
        console.error(
          `[Plugin ${element.pluginId}] Failed to evaluate context menu "${kind}" for item ${index}:`,
          error,
        );
      },
    );

    const items: ListItem[] = [...top];

    if (enableDelete) {
      items.push({
        id: 'delete',
        label: pluginTranslate(deleteLabel, undefined, deleteLabel),
      });
    }

    // z-order 항목 추가
    items.push(
      { id: 'bringToFront', label: t('contextMenu.bringToFront') },
      // { id: "bringForward", label: t("contextMenu.bringForward") },
      // { id: "sendBackward", label: t("contextMenu.sendBackward") },
      { id: 'sendToBack', label: t('contextMenu.sendToBack') },
    );

    items.push(...bottom);

    return items;
  })();

  // 컨텍스트 메뉴 항목 선택
  const handleContextMenuSelect = (itemId: string) => {
    if (itemId === 'delete') {
      deletePluginElement();
    } else if (itemId === 'bringToFront') {
      void commitStableLayerZOrder({
        mode: element.tabId ?? useKeyStore.getState().selectedKeyType,
        targets: [{ type: 'plugin', id: element.fullId }],
        action: 'front',
      }).catch(reportElementOpError);
    } else if (itemId === 'bringForward') {
      void commitStableLayerZOrder({
        mode: element.tabId ?? useKeyStore.getState().selectedKeyType,
        targets: [{ type: 'plugin', id: element.fullId }],
        action: 'forward',
      }).catch(reportElementOpError);
    } else if (itemId === 'sendBackward') {
      void commitStableLayerZOrder({
        mode: element.tabId ?? useKeyStore.getState().selectedKeyType,
        targets: [{ type: 'plugin', id: element.fullId }],
        action: 'backward',
      }).catch(reportElementOpError);
    } else if (itemId === 'sendToBack') {
      void commitStableLayerZOrder({
        mode: element.tabId ?? useKeyStore.getState().selectedKeyType,
        targets: [{ type: 'plugin', id: element.fullId }],
        action: 'back',
      }).catch(reportElementOpError);
    } else if (itemId.startsWith('custom-')) {
      const index = parseInt(itemId.replace('custom-', ''), 10);
      // 동결 배열로만 역참조 - 항목 id의 index와 같은 배열임을 보장
      const customItem = frozenCustomItemsRef.current?.[index];
      if (customItem) {
        // 커스텀 메뉴 실행 (자동 래핑되어 있음)
        try {
          observePluginAction(
            customItem.onClick({
              element,
              actions: createActionsProxy(element.fullId),
            }),
            `context action ${index}`,
          );
        } catch (error) {
          console.error(
            `[PluginElement] context action ${index} failed`,
            error,
          );
        }
      }
    }
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

      {/* 컨텍스트 메뉴 - 줌 영향을 받지 않도록 body에 Portal로 렌더링 */}
      {windowType === 'main' &&
        element.contextMenu &&
        contextMenuPresence.mounted &&
        createPortal(
          <ListPopup
            open={contextMenuOpen}
            ariaLabel={t('common.more')}
            position={contextMenuPosition}
            onClose={() => setContextMenuOpen(false)}
            items={contextMenuItems}
            onSelect={handleContextMenuSelect}
          />,
          document.body,
        )}
    </>
  );
};

// 요소 하나의 갱신이 나머지 전체 리렌더로 번지지 않도록 차단
// (스토어 update 경로는 미변경 요소의 참조를 유지하므로 shallow 비교로 스킵됨)
export const PluginElement = React.memo(PluginElementImpl);
