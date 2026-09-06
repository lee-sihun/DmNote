import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { keysApi } from '@api/modules/editor/keysApi';

declare global {
  interface Window {
    __dmn_current_plugin_id?: string;
  }
}
import { useTranslation } from '@contexts/useTranslation';
import {
  commitStableLayerZOrder,
  orderStableZTargetsForBatch,
} from '@src/renderer/editor/runtime/intent/layerZOrderIntent';
import {
  reportElementOpError,
  reportElementOpSkipped,
} from '@src/renderer/editor/runtime/intent/elementIntent';
import {
  resolveElementById,
  type NativeElementType,
} from '@src/renderer/editor/model/elementIdMap';
import { isNativeElementId } from '@src/renderer/editor/model/elementId';
import TabCssModal from '../../Modal/content/editors/TabCssModal';
import TabNoteSettingModal from '../../Modal/content/editors/TabNoteSettingModal';
import ListPopup from '../../Modal/listPopup/ListPopup';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useSpriteStore } from '@stores/data/useSpriteStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { PluginElementsRenderer } from '@components/shared/plugin/PluginElementsRenderer';
import { useGridZoomPan } from '@hooks/Grid/viewport/useGridZoomPan';
import {
  addCanvasElementAt,
  placeFrozenDuplicateAt,
  useGridCanvasActions,
} from '@hooks/Grid/contextMenu/useGridCanvasActions';
import type { DuplicateState } from '@hooks/Grid/contextMenu/useGridCanvasActions';
import GridMinimap from './GridMinimap';
import GridBackground from './GridBackground';
import SmartGuidesOverlay from '../overlays/SmartGuidesOverlay';
import MarqueeSelectionOverlay from '../overlays/MarqueeSelectionOverlay';
import { useGradientEditStore } from '@stores/grid/useGradientEditStore';
import { useSpritePoseHandleStore } from '@stores/grid/useSpritePoseHandleStore';
import { getGridViewportLayerStyles } from '@utils/grid/gridViewportStyles';
import KeyCounterPreviewLayer from '../layers/KeyCounterPreviewLayer';
import StatCounterLayer from '../layers/StatCounterLayer';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { openPropertiesPanelForSelection } from '@stores/grid/usePanelHostStore';
import { useUIStore } from '@stores/useUIStore';
import { useSmartGuidesStore } from '@stores/grid/useSmartGuidesStore';
import { useSettingsStore } from '@stores/useSettingsStore';
import {
  snapCursorToGrid,
  useGridKeyboard,
  useGridSelection,
  useGridContextMenu,
  useGridMarquee,
  useGridResize,
  useSmartGuidesElements,
} from '@hooks/Grid';
import { createDefaultCounterSettings } from '@src/types/key/keys';
import type {
  KeyMappings,
  KeyCounterSettings,
  CounterAnimationBezier,
} from '@src/types/key/keys';
import { slotCanonical, slotDisplayName } from '@utils/keySlot';
import { overlayApi } from '@api/modules/window/overlayApi';
import { panelWindowApi } from '@api/modules/window/panelWindowApi';
import {
  groupSelectedElements,
  ungroupSelectedElements,
} from '@utils/grid/groupActions';
import { expandGroupSelection } from '@utils/grid/groupSelection';
import {
  composePreviewPositions,
  getPreviewOverlayVersion,
  subscribePreviewOverlay,
} from '@src/renderer/editor/runtime/gesture/previewOverlay';
import {
  buildMixedSelectionMenuItems,
  gridAddTypeForMenuItem,
  isStableNativeSelection,
  shouldOpenMixedSelectionMenu,
} from './gridContextMenuModel';
import DuplicateElementGhost from './DuplicateElementGhost';
import NativeGridElements from './NativeGridElements';
import GridSelectionOverlays from '../overlays/GridSelectionOverlays';
import { executeNativeContextMenuAction } from './nativeContextMenuActions';
import { useSelectedElementDragLifecycle } from '@hooks/Grid/drag/useSelectedElementDragLifecycle';

type ToolbarAddRequest = {
  id: number;
  type: NativeElementType;
} | null;

interface GridProps {
  showConfirm: (
    message: string,
    onConfirm: () => void,
    options?: {
      onCancel?: () => void;
      confirmText?: string;
      cancelText?: string;
      danger?: boolean;
    },
  ) => void;
  showAlert: (message: string, confirmText?: string) => void;
  keyMappings: KeyMappings;
  positions: ReturnType<typeof useKeyStore.getState>['positions'];
  color: string;
  activeTool: string;
  onUndo: () => void;
  onRedo: () => void;
  toolbarAddRequest: ToolbarAddRequest;
  onToolbarAddConsumed: (() => void) | undefined;
  isNoteSettingOpen: boolean;
  setIsNoteSettingOpen: (open: boolean) => void;
}

const Grid = ({
  showConfirm,
  showAlert,
  keyMappings,
  positions,
  color,
  activeTool,
  onUndo,
  onRedo,
  toolbarAddRequest,
  onToolbarAddConsumed,
  isNoteSettingOpen,
  setIsNoteSettingOpen,
}: GridProps) => {
  const selectedKeyType = useKeyStore((state) => state.selectedKeyType);

  // 캔버스 요소(stat/graph) CRUD 액션 훅
  const canvasActions = useGridCanvasActions(selectedKeyType);

  const keyCounterEnabled = useSettingsStore(
    (state) => state.keyCounterEnabled,
  );
  const noteEffect = useSettingsStore((state) => state.noteEffect);
  const minimapEnabled = useSettingsStore(
    (state) => state.gridSettings.minimapEnabled,
  );
  const gridSnapSize = useSettingsStore(
    (state) => state.gridSettings?.gridSnapSize ?? 5,
  );
  const { t, i18n } = useTranslation();
  const locale = i18n.language;

  // 그리드 컨테이너 및 콘텐츠 ref
  const gridContainerRef = useRef<HTMLDivElement | null>(null);
  const gridContentRef = useRef<HTMLDivElement | null>(null);

  // 줌/팬 훅
  const {
    zoom,
    panX,
    panY,
    clientToGridCoords,
    gridToClientCoords: _gridToClientCoords,
    zoomIn,
    zoomOut,
    resetZoom,
    minZoom: _minZoom,
    maxZoom: _maxZoom,
    isTransforming,
  } = useGridZoomPan({
    mode: selectedKeyType,
    containerRef: gridContainerRef,
    contentRef: gridContentRef,
  });
  const gridViewportStyles = getGridViewportLayerStyles(
    panX,
    panY,
    zoom,
    isTransforming,
  );

  // 컨텍스트 메뉴 훅 사용
  const {
    getKeyMenuItems,
    getStatMenuItems,
    getGraphMenuItems,
    getKnobMenuItems,
    getSpriteMenuItems,
    getGridMenuItems,
    pluginKeyMenuItems,
    pluginGridMenuItems,
  } = useGridContextMenu({
    selectedKeyType,
    keyMappings,
    positions,
    locale,
    t,
    noteEffect,
  });

  // 선택 상태 관리
  // 온캔버스 그라데이션 편집 중 여부 — 리사이즈 핸들을 잠시 숨김
  const hasGradientEditSession = useGradientEditStore(
    (state) => state.session !== null,
  );
  // 스프라이트 자세 편집 중 여부 - 자세 프레임이 리사이즈 핸들을 대신한다
  const hasSpritePoseSession = useSpritePoseHandleStore(
    (state) => state.session !== null,
  );
  const selectedElements = useGridSelectionStore(
    (state) => state.selectedElements,
  );
  const toggleSelection = useGridSelectionStore(
    (state) => state.toggleSelection,
  );
  const clearSelection = useGridSelectionStore((state) => state.clearSelection);
  const setSelectedElements = useGridSelectionStore(
    (state) => state.setSelectedElements,
  );
  const lastSelectedKeyBounds = useGridSelectionStore(
    (state) => state.lastSelectedKeyBounds,
  );
  const setLastSelectedKeyBounds = useGridSelectionStore(
    (state) => state.setLastSelectedKeyBounds,
  );

  // 클립보드 상태 (복사/붙여넣기용)
  const _clipboard = useGridSelectionStore((state) => state.clipboard);

  // 플러그인 요소 가져오기
  const pluginElements = usePluginDisplayElementStore(
    (state) => state.elements,
  );
  // 내장 통계 요소(Stat Items) 위치 정보
  const canonicalStatPositions = useStatItemStore((state) => state.positions);
  const canonicalGraphPositions = useGraphItemStore((state) => state.positions);
  const canonicalKnobPositions = useKnobItemStore((state) => state.positions);
  const canonicalSpritePositions = useSpriteStore((state) => state.positions);
  useSyncExternalStore(
    subscribePreviewOverlay,
    getPreviewOverlayVersion,
    getPreviewOverlayVersion,
  );
  const statPositions = composePreviewPositions(
    'statPosition',
    canonicalStatPositions,
  );
  const graphPositions = composePreviewPositions(
    'graphPosition',
    canonicalGraphPositions,
  );
  const knobPositions = composePreviewPositions(
    'knobPosition',
    canonicalKnobPositions,
  );
  const spritePositions = composePreviewPositions(
    'spritePosition',
    canonicalSpritePositions,
  );

  // 선택 관련 로직 훅 사용
  const {
    moveSelectedElements,
    deleteSelectedElements,
    copySelectedElements,
    pasteElements,
    syncSelectedElementsToOverlay,
    freezeSelectionForGesture,
  } = useGridSelection({
    selectedElements,
    selectedKeyType,
    keyMappings,
    positions,
  });
  const {
    beginSelectedElementsDrag: beginSelectedPluginInstancesDrag,
    commitSelectedElementsDrag,
    moveSelectedElementsDrag,
  } = useSelectedElementDragLifecycle({
    freezeSelectionForGesture,
    syncSelectedElementsToOverlay,
    moveSelectedElements: (deltaX, deltaY) =>
      moveSelectedElements(deltaX, deltaY, undefined, false),
  });

  // 마퀴 선택 훅 사용
  const { isMarqueeSelecting: _isMarqueeSelecting, startMarqueeSelection } =
    useGridMarquee({
      positions,
      statPositions,
      graphPositions,
      knobPositions,
      spritePositions,
      selectedKeyType,
      pluginElements,
      clientToGridCoords,
    });

  // 스마트 가이드를 위한 다른 요소들의 bounds 가져오기
  const { getOtherElements } = useSmartGuidesElements();

  // 리사이즈 훅 사용
  const {
    handleResizeStart,
    handleResize,
    handleResizeComplete,
    previewBounds,
    // 그룹 리사이즈 관련
    handleGroupResize,
    handleGroupResizeComplete,
    previewGroupBounds,
    previewElementBounds,
  } = useGridResize({
    selectedElements,
    selectedKeyType,
    getOtherElements,
  });

  // 선택된 요소의 z-order 조작 핸들러
  const handleSelectedMoveForward = async () => {
    if (selectedElements.length !== 1) return;
    const selected = selectedElements[0];
    if (selected.type === 'plugin' || isNativeElementId(selected.id)) {
      await commitStableLayerZOrder({
        mode: selectedKeyType,
        targets: [{ type: selected.type, id: selected.id }],
        action: 'forward',
      });
    }
    syncSelectedElementsToOverlay();
  };

  const handleSelectedMoveBackward = async () => {
    if (selectedElements.length !== 1) return;
    const selected = selectedElements[0];
    if (selected.type === 'plugin' || isNativeElementId(selected.id)) {
      await commitStableLayerZOrder({
        mode: selectedKeyType,
        targets: [{ type: selected.type, id: selected.id }],
        action: 'backward',
      });
    }
    syncSelectedElementsToOverlay();
  };

  // 키보드 단축키 훅 사용
  useGridKeyboard({
    selectedElements,
    moveSelectedElements,
    deleteSelectedElements,
    clearSelection,
    copySelectedElements,
    pasteElements,
    onUndo,
    onRedo,
    onMoveForward: handleSelectedMoveForward,
    onMoveBackward: handleSelectedMoveBackward,
    newGroupLabel: t('layerGroup.newGroup') || 'New Group',
  });

  // 키 컨텍스트 메뉴
  const [isContextOpen, setIsContextOpen] = useState<boolean>(false);
  const [contextIndex, setContextIndex] = useState<number | null>(null);
  // 메뉴 대상의 안정 신원 - 열림 동안 재정렬돼도 액션이 같은 요소를 향한다
  const [contextElementId, setContextElementId] = useState<string | null>(null);
  const [contextType, setContextType] = useState<string>('key');
  const contextRef = useRef<HTMLElement | null>(null);
  const [contextPosition, setContextPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [duplicateState, setDuplicateState] = useState<DuplicateState | null>(
    null,
  );
  const [duplicateCursor, setDuplicateCursor] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const lastMousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const mixedSelectionMenuItems = buildMixedSelectionMenuItems(
    selectedElements,
    selectedElements.length >= 2
      ? {
          mode: selectedKeyType,
          keyPositions: positions[selectedKeyType] || [],
          statPositions:
            useStatItemStore.getState().positions[selectedKeyType] || [],
          graphPositions:
            useGraphItemStore.getState().positions[selectedKeyType] || [],
          knobPositions:
            useKnobItemStore.getState().positions[selectedKeyType] || [],
          spritePositions:
            useSpriteStore.getState().positions[selectedKeyType] || [],
          pluginElements: usePluginDisplayElementStore.getState().elements,
          modeGroups:
            useLayerGroupStore.getState().layerGroups[selectedKeyType] || [],
        }
      : null,
    t,
  );

  const openMixedSelectionContextMenu = (
    x: number,
    y: number,
    referenceNode: HTMLElement | null,
  ) => {
    setContextType('mixed');
    setContextIndex(null);
    contextRef.current = referenceNode || null;
    setContextPosition({ x, y });
    setIsContextOpen(true);
  };

  // 클라이언트 좌표를 그리드 좌표로 변환 (줌/팬 반영)
  const computeSnappedCursorFromClient = (clientX: number, clientY: number) => {
    const gridCoords = clientToGridCoords(clientX, clientY);
    if (!gridCoords) return null;
    return snapCursorToGrid(gridCoords.x, gridCoords.y);
  };

  // 복제 시작은 로컬 UI 상태(duplicateState) 설정이 필요하므로 래퍼 사용
  const beginDuplicateStat = (sourceIndex: number) => {
    const result = canvasActions.beginDuplicateStat(sourceIndex);
    if (!result) return;
    setDuplicateState(result);
    setDuplicateCursor(null);
  };

  const beginDuplicateGraph = (sourceIndex: number) => {
    const result = canvasActions.beginDuplicateGraph(sourceIndex);
    if (!result) return;
    setDuplicateState(result);
    setDuplicateCursor(null);
  };

  const beginDuplicateKnob = (sourceIndex: number) => {
    const result = canvasActions.beginDuplicateKnob(sourceIndex);
    if (!result) return;
    setDuplicateState(result);
    setDuplicateCursor(null);
  };

  const beginDuplicateSprite = (sourceIndex: number) => {
    const result = canvasActions.beginDuplicateSprite(sourceIndex);
    if (!result) return;
    setDuplicateState(result);
    setDuplicateCursor(null);
  };

  const beginDuplicateKey = (sourceIndex: number) => {
    const sourceSlot =
      useKeyStore.getState().keyMappings[selectedKeyType]?.[sourceIndex];
    const position =
      useKeyStore.getState().canonicalPositions[selectedKeyType]?.[
        sourceIndex
      ] || null;
    if (!position || typeof sourceSlot === 'undefined') return;

    const clonedNoteColor =
      position.noteColor &&
      typeof position.noteColor === 'object' &&
      position.noteColor !== null
        ? { ...position.noteColor }
        : position.noteColor;
    const clonedCounter: KeyCounterSettings | null = position.counter
      ? {
          ...position.counter,
          fill: { ...position.counter.fill },
          ...(position.counter.animation
            ? {
                animation: {
                  ...position.counter.animation,
                  bezier: [
                    ...position.counter.animation.bezier,
                  ] as CounterAnimationBezier,
                },
              }
            : {}),
        }
      : null;
    const currentMousePos = lastMousePosRef.current;
    computeSnappedCursorFromClient(currentMousePos.x, currentMousePos.y);
    setDuplicateState({
      elementType: 'key',
      sourceIndex,
      slot: sourceSlot,
      keyName: slotDisplayName(sourceSlot),
      position: {
        ...position,
        noteColor: clonedNoteColor,
        counter: clonedCounter ?? createDefaultCounterSettings(),
      },
    });
    setDuplicateCursor(null);
  };

  const duplicateSelectedFromContextMenu = async () => {
    copySelectedElements();
    await pasteElements().catch(reportElementOpError);
  };

  const moveSelectedToFront = async () => {
    if (selectedElements.length === 0) return;

    if (
      selectedElements.every(
        (element) =>
          element.type === 'plugin' || isStableNativeSelection(element),
      )
    ) {
      await commitStableLayerZOrder({
        mode: selectedKeyType,
        targets: orderStableZTargetsForBatch(
          selectedElements.map((element) => ({
            type: element.type as NativeElementType | 'plugin',
            id: element.id,
          })),
        ),
        action: 'front',
      }).catch(reportElementOpError);
      syncSelectedElementsToOverlay();
      return;
    }
    reportElementOpError(new Error('Invalid native selection ID'));
  };

  const moveSelectedToBack = async () => {
    if (selectedElements.length === 0) return;

    if (
      selectedElements.every(
        (element) =>
          element.type === 'plugin' || isStableNativeSelection(element),
      )
    ) {
      await commitStableLayerZOrder({
        mode: selectedKeyType,
        targets: orderStableZTargetsForBatch(
          selectedElements.map((element) => ({
            type: element.type as NativeElementType | 'plugin',
            id: element.id,
          })),
        ),
        action: 'back',
      }).catch(reportElementOpError);
      syncSelectedElementsToOverlay();
      return;
    }

    reportElementOpError(new Error('Invalid native selection ID'));
  };

  useEffect(() => {
    if (!toolbarAddRequest) return;

    const getViewportCenterSnappedPosition = (
      width: number,
      height: number,
    ) => {
      const container = gridContainerRef.current;
      if (!container) return null;
      const rect = container.getBoundingClientRect();
      const centerClientX = rect.left + rect.width / 2;
      const centerClientY = rect.top + rect.height / 2;
      const gridCoords = clientToGridCoords(centerClientX, centerClientY);
      if (!gridCoords) return null;
      const targetX = gridCoords.x - width / 2;
      const targetY = gridCoords.y - height / 2;
      const snapped = snapCursorToGrid(targetX, targetY);
      return {
        dx: snapped.x,
        dy: snapped.y,
      };
    };

    const defaultSize =
      toolbarAddRequest.type === 'graph'
        ? { width: 120, height: 60 }
        : toolbarAddRequest.type === 'sprite'
        ? { width: 200, height: 200 }
        : { width: 60, height: 60 };
    const targetPos = getViewportCenterSnappedPosition(
      defaultSize.width,
      defaultSize.height,
    );
    if (targetPos) {
      addCanvasElementAt(
        canvasActions,
        toolbarAddRequest.type,
        targetPos.dx,
        targetPos.dy,
      );
    }

    onToolbarAddConsumed?.();
  });

  // 탭 CSS 모달 상태
  const [isTabCssModalOpen, setIsTabCssModalOpen] = useState<boolean>(false);
  // 탭 노트 트랙 설정 모달 상태
  const [isTabNoteModalOpen, setIsTabNoteModalOpen] = useState<boolean>(false);

  // 전역 트랙 설정 모달이 열리면 탭 트랙 설정 모달 닫기 (중복 방지)
  useEffect(() => {
    if (isNoteSettingOpen) setIsTabNoteModalOpen(false);
  }, [isNoteSettingOpen]);

  // 그리드 영역 호버 상태 (미니맵 표시용) - useUIStore에서 관리
  const _isGridAreaHovered = useUIStore((state) => state.isGridAreaHovered);

  // 기타 설정 팝업 열림 상태 (미니맵 표시 제어용)
  const _isExtrasPopupOpen = useUIStore((state) => state.isExtrasPopupOpen);

  // 불러오기/내보내기 팝업 열림 상태 (미니맵 표시 제어용)
  const _isExportImportPopupOpen = useUIStore(
    (state) => state.isExportImportPopupOpen,
  );
  const previousSelectedKeyTypeRef = useRef<string>(selectedKeyType);

  // 탭 변경 시 선택 해제. 대기 중인 스프라이트 복제는 함께 취소한다 - 원본 탭
  // 요소를 다른 탭에 놓으면 자세 트리거가 원본 탭 키를 가리켜 죽는다. 다른
  // 종류는 탭을 넘어 배치할 수 있으므로 그대로 둔다.
  // 탭 바는 그리드 밖이라 배치 취소용 onMouseDownCapture도 타지 않는다
  useEffect(() => {
    if (previousSelectedKeyTypeRef.current !== selectedKeyType) {
      clearSelection();
      setDuplicateState((prev) =>
        prev?.elementType === 'sprite' ? null : prev,
      );
      previousSelectedKeyTypeRef.current = selectedKeyType;
    }
  }, [selectedKeyType, clearSelection]);

  // 그리드 컨텍스트 메뉴
  const [isGridContextOpen, setIsGridContextOpen] = useState<boolean>(false);
  const [gridContextClientPos, setGridContextClientPos] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [gridAddLocalPos, setGridAddLocalPos] = useState<{
    dx: number;
    dy: number;
  } | null>(null);

  // 전역 마우스 위치 추적
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      lastMousePosRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // 요소 클릭 시 그룹 멤버 자동 선택
  const selectElementWithGroup = (type: NativeElementType, index: number) => {
    if (isContextOpen) {
      setIsContextOpen(false);
      setContextPosition(null);
    }
    const collections = {
      key: positions[selectedKeyType] || [],
      stat: useStatItemStore.getState().positions[selectedKeyType] || [],
      graph: useGraphItemStore.getState().positions[selectedKeyType] || [],
      knob: useKnobItemStore.getState().positions[selectedKeyType] || [],
      sprite: useSpriteStore.getState().positions[selectedKeyType] || [],
    } as const;

    const clicked = collections[type][index];
    // stat·graph·knob·sprite는 렌더 클로저가 아니라 live 스토어를 읽는다. 렌더와
    // 클릭 사이에 배열이 줄면 대상이 없을 수 있어 fail-closed로 닫는다
    if (!clicked) {
      reportElementOpSkipped('group selection (target missing)');
      return;
    }
    // 같은 그룹의 native·플러그인 멤버 전체 확장 (공용 헬퍼)
    const nextSelection = expandGroupSelection(
      { type, id: clicked.id, index },
      {
        mode: selectedKeyType,
        keyPositions: collections.key,
        statPositions: collections.stat,
        graphPositions: collections.graph,
        knobPositions: collections.knob,
        spritePositions: collections.sprite,
        pluginElements: usePluginDisplayElementStore.getState().elements,
        modeGroups:
          useLayerGroupStore.getState().layerGroups[selectedKeyType] || [],
      },
    );
    // 그룹 멤버 수와 무관하게 선택 Store 알림·React render를 1회로 유지
    setSelectedElements(nextSelection);
  };

  const toggleNativeElementSelection = (
    type: NativeElementType,
    index: number,
  ) => {
    const elementId =
      type === 'key'
        ? positions[selectedKeyType][index].id
        : type === 'stat'
        ? useStatItemStore.getState().positions[selectedKeyType][index].id
        : type === 'graph'
        ? useGraphItemStore.getState().positions[selectedKeyType][index].id
        : type === 'sprite'
        ? useSpriteStore.getState().positions[selectedKeyType][index].id
        : useKnobItemStore.getState().positions[selectedKeyType][index].id;
    toggleSelection({ type, id: elementId, index });
  };

  // 더블클릭 편집 진입 — 대상이 다중 선택의 멤버면 선택을 보존해 배치 편집으로,
  // 아니면 해당 요소(+그룹)만 선택해 단일 편집으로 property 페이지를 연다
  const openElementEditor = (type: NativeElementType, index: number) => {
    const { selectedElements: currentSelection } =
      useGridSelectionStore.getState();
    const positionsForType =
      type === 'key'
        ? positions[selectedKeyType]
        : type === 'stat'
        ? statPositions[selectedKeyType]
        : type === 'graph'
        ? graphPositions[selectedKeyType]
        : type === 'sprite'
        ? spritePositions[selectedKeyType]
        : knobPositions[selectedKeyType];
    const targetId = positionsForType?.[index]?.id;
    const isMultiMember =
      currentSelection.length > 1 &&
      typeof targetId === 'string' &&
      currentSelection.some((el) => el.type === type && el.id === targetId);
    if (!isMultiMember) {
      selectElementWithGroup(type, index);
    }
    openPropertiesPanelForSelection();
  };

  // 요소 컨텍스트 메뉴 열기
  const openElementContextMenu = (
    type: NativeElementType,
    index: number,
    clientX: number,
    clientY: number,
    ref: HTMLElement | null,
  ) => {
    if (duplicateState) {
      setDuplicateState(null);
      setDuplicateCursor(null);
    }
    const clickedPosition =
      type === 'key'
        ? positions[selectedKeyType]?.[index]
        : type === 'stat'
        ? useStatItemStore.getState().positions[selectedKeyType]?.[index]
        : type === 'graph'
        ? useGraphItemStore.getState().positions[selectedKeyType]?.[index]
        : type === 'sprite'
        ? useSpriteStore.getState().positions[selectedKeyType]?.[index]
        : useKnobItemStore.getState().positions[selectedKeyType]?.[index];
    // 조회가 옵셔널인데 여기서 무방비로 풀면, 렌더와 우클릭 사이에 배열이 줄었을 때
    // TypeError가 나고 에러 바운더리가 없어 앱이 통째로 언마운트된다.
    // id가 없으면 혼합 선택 판정 자체가 성립하지 않으므로 그냥 건너뛴다
    const clickedId = clickedPosition?.id;
    if (
      clickedId &&
      shouldOpenMixedSelectionMenu(selectedElements, clickedId)
    ) {
      openMixedSelectionContextMenu(clientX, clientY, ref);
      return;
    }
    setContextType(type);
    setContextIndex(index);
    setContextElementId(
      typeof clickedPosition?.id === 'string' && clickedPosition.id.length > 0
        ? clickedPosition.id
        : null,
    );
    contextRef.current = ref;
    setContextPosition({ x: clientX, y: clientY });
    setIsContextOpen(true);
  };

  // 그리드 좌클릭 핸들러 (빈 공간에서 드래그로 마퀴 선택 시작)
  const handleGridMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // 좌클릭만 처리
    if (e.button !== 0) return;

    // 복제 상태일 때는 무시
    if (duplicateState) return;

    // 이벤트 타겟이 그리드 컨테이너나 그리드 콘텐츠인 경우에만 마퀴 선택 시작
    // (키나 플러그인 요소에서 버블링된 이벤트 필터링)
    const target = e.target;
    const isGridContainer = target === gridContainerRef.current;
    const isGridContent = target === gridContentRef.current;

    if (!isGridContainer && !isGridContent) {
      return;
    }

    // 클릭 시 스마트 가이드 클리어 (드래그가 정상 종료되지 않은 경우 대비)
    useSmartGuidesStore.getState().clearGuides();

    // 그리드 빈 공간에서 드래그로 마퀴 선택 시작
    const gridCoords = clientToGridCoords(e.clientX, e.clientY);
    if (gridCoords) {
      startMarqueeSelection(gridCoords.x, gridCoords.y);
    }
  };

  return (
    <div
      ref={(node) => {
        gridRef.current = node;
        gridContainerRef.current = node;
      }}
      data-grid-container
      className="relative isolate w-full h-full bg-panel rounded-[0px] overflow-hidden"
      style={color === 'transparent' ? undefined : { backgroundColor: color }}
      onContextMenu={(e) => {
        if (duplicateState) {
          setDuplicateState(null);
          setDuplicateCursor(null);
        }
        e.preventDefault();
        e.stopPropagation();
        // 줌/팬 반영된 그리드 좌표 계산
        const gridCoords = clientToGridCoords(e.clientX, e.clientY);
        if (!gridCoords) return;
        const snapped = snapCursorToGrid(gridCoords.x, gridCoords.y);
        setGridAddLocalPos({ dx: snapped.x, dy: snapped.y });
        setGridContextClientPos({ x: e.clientX, y: e.clientY });
        setIsGridContextOpen(true);
      }}
      onMouseDown={handleGridMouseDown}
      onMouseMove={(e) => {
        if (duplicateState) {
          const snapped = computeSnappedCursorFromClient(e.clientX, e.clientY);
          if (snapped) {
            setDuplicateCursor(snapped);
          }
        }
      }}
      onMouseEnter={() => {}}
      onMouseLeave={() => {
        if (duplicateState) setDuplicateCursor(null);
      }}
      onMouseDownCapture={(e) => {
        if (!duplicateState || e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const snapped = computeSnappedCursorFromClient(e.clientX, e.clientY);
        if (snapped) {
          // 마우스 위치에서 키의 중심이 배치되도록 조정
          const width = duplicateState.position.width || 60;
          const height = duplicateState.position.height || 60;
          placeFrozenDuplicateAt(
            canvasActions,
            duplicateState,
            snapped.x - width / 2,
            snapped.y - height / 2,
          );
        }
        setDuplicateState(null);
        setDuplicateCursor(null);
      }}
    >
      {/* 정확한 그리드 배경 */}
      <GridBackground
        gridSize={gridSnapSize}
        zoom={zoom}
        panX={panX}
        panY={panY}
      />
      {/* 팬과 줌을 같은 합성 레이어에 넣으면 이동 중 기존 배율의 래스터가
          다시 샘플링된다 - 이동 레이어는 최종 배율로 그려진 안쪽만 옮김 */}
      <div className="absolute" style={gridViewportStyles.pan}>
        <div
          key={selectedKeyType}
          ref={gridContentRef}
          className="absolute"
          data-dmn-grid-space=""
          data-dmn-user-css-scope=""
          style={gridViewportStyles.scale}
        >
          <NativeGridElements
            mode={selectedKeyType}
            keyPositions={positions[selectedKeyType]}
            keyMappings={keyMappings[selectedKeyType]}
            statPositions={statPositions?.[selectedKeyType] || []}
            graphPositions={graphPositions?.[selectedKeyType] || []}
            knobPositions={knobPositions?.[selectedKeyType] || []}
            spritePositions={spritePositions?.[selectedKeyType] || []}
            pluginElements={pluginElements}
            selectedElements={selectedElements}
            activeTool={activeTool}
            zoom={zoom}
            panX={panX}
            panY={panY}
            isViewportTransforming={isTransforming}
            keyCounterEnabled={keyCounterEnabled}
            lastSelectedKeyBounds={lastSelectedKeyBounds}
            onSelectElement={selectElementWithGroup}
            onToggleElement={toggleNativeElementSelection}
            onClearSelection={clearSelection}
            onSetSelectedElements={setSelectedElements}
            onSetLastSelectedKeyBounds={setLastSelectedKeyBounds}
            onMoveSelection={moveSelectedElementsDrag}
            onMultiDragStart={beginSelectedPluginInstancesDrag}
            onMultiDragEnd={commitSelectedElementsDrag}
            onOpenElementEditor={openElementEditor}
            onOpenElementContextMenu={openElementContextMenu}
          />
          {/* Outside 카운터 미리보기 레이어 */}
          {keyCounterEnabled && (
            <KeyCounterPreviewLayer
              positions={positions[selectedKeyType]}
              previewValue={0}
              selectedElements={selectedElements}
            />
          )}
          <StatCounterLayer
            positions={statPositions?.[selectedKeyType] || []}
            selectedElements={selectedElements}
          />
          <DuplicateElementGhost
            duplicate={duplicateState}
            cursor={duplicateCursor}
            zoom={zoom}
          />
          <PluginElementsRenderer
            windowType="main"
            activeTool={activeTool}
            zoom={zoom}
            panX={panX}
            panY={panY}
            isViewportTransforming={isTransforming}
            onSelectionContextMenu={({
              elementId,
              clientX,
              clientY,
              referenceElement,
            }) => {
              if (duplicateState) {
                setDuplicateState(null);
                setDuplicateCursor(null);
              }
              if (!shouldOpenMixedSelectionMenu(selectedElements, elementId))
                return false;
              openMixedSelectionContextMenu(
                clientX,
                clientY,
                referenceElement || null,
              );
              return true;
            }}
            onMultiDrag={moveSelectedElementsDrag}
            onMultiDragStart={beginSelectedPluginInstancesDrag}
            onMultiDragEnd={commitSelectedElementsDrag}
          />
        </div>
      </div>
      {/* 스마트 가이드 오버레이 */}
      <SmartGuidesOverlay zoom={zoom} panX={panX} panY={panY} />
      {/* 마퀴 선택 오버레이 */}
      <MarqueeSelectionOverlay zoom={zoom} panX={panX} panY={panY} />
      <GridSelectionOverlays
        selectedElements={selectedElements}
        positions={positions}
        statPositions={statPositions}
        graphPositions={graphPositions}
        knobPositions={knobPositions}
        spritePositions={spritePositions}
        mode={selectedKeyType}
        pluginElements={pluginElements}
        zoom={zoom}
        panX={panX}
        panY={panY}
        hasGradientEditSession={hasGradientEditSession}
        hasSpritePoseSession={hasSpritePoseSession}
        previewBounds={previewBounds}
        previewGroupBounds={previewGroupBounds}
        previewElementBounds={previewElementBounds}
        onResizeStart={handleResizeStart}
        onResize={handleResize}
        onResizeEnd={handleResizeComplete}
        onGroupResize={handleGroupResize}
        onGroupResizeEnd={handleGroupResizeComplete}
        getOtherElements={getOtherElements}
      />
      {/* 우클릭 리스트 팝업 */}
      <div className="relative">
        <ListPopup
          open={isContextOpen}
          ariaLabel={t('common.more')}
          referenceRef={contextRef}
          position={contextPosition || undefined}
          onClose={() => {
            setIsContextOpen(false);
            setContextPosition(null);
          }}
          items={
            contextType === 'mixed'
              ? mixedSelectionMenuItems
              : contextType === 'stat'
              ? getStatMenuItems(contextIndex)
              : contextType === 'graph'
              ? getGraphMenuItems(contextIndex)
              : contextType === 'knob'
              ? getKnobMenuItems(contextIndex)
              : contextType === 'sprite'
              ? getSpriteMenuItems(contextIndex)
              : getKeyMenuItems(contextIndex, contextElementId)
          }
          onSelect={async (id: string) => {
            if (contextType === 'mixed') {
              if (id === 'delete') {
                await deleteSelectedElements().catch(reportElementOpError);
              } else if (id === 'duplicate') {
                await duplicateSelectedFromContextMenu();
              } else if (id === 'bringToFront') {
                await moveSelectedToFront();
              } else if (id === 'sendToBack') {
                await moveSelectedToBack();
              } else if (id === 'groupSelected') {
                await groupSelectedElements(
                  selectedKeyType,
                  selectedElements,
                  t('layerGroup.newGroup') || 'New Group',
                );
              } else if (id === 'ungroupSelected') {
                await ungroupSelectedElements(
                  selectedKeyType,
                  selectedElements,
                );
              }

              setIsContextOpen(false);
              setContextPosition(null);
              return;
            }

            if (contextIndex == null) return;

            // 메뉴가 열린 동안의 재정렬·삭제를 액션 시점에 재해석.
            // 모드 밖으로 이동한 대상은 소실로 취급한다
            const resolveContextTarget = (
              targetType: NativeElementType,
            ): number | null => {
              if (!contextElementId) return null;
              const locator = resolveElementById(targetType, contextElementId);
              return locator && locator.mode === selectedKeyType
                ? locator.index
                : null;
            };

            if (
              contextType === 'stat' ||
              contextType === 'graph' ||
              contextType === 'knob' ||
              contextType === 'sprite'
            ) {
              const targetType = contextType;
              const targetIndex = resolveContextTarget(targetType);
              executeNativeContextMenuAction({
                menuItemId: id,
                type: targetType,
                mode: selectedKeyType,
                elementId: contextElementId,
                resolvedIndex: targetIndex,
                onDuplicate: (resolvedIndex) => {
                  if (targetType === 'stat') beginDuplicateStat(resolvedIndex);
                  else if (targetType === 'graph')
                    beginDuplicateGraph(resolvedIndex);
                  else if (targetType === 'sprite')
                    beginDuplicateSprite(resolvedIndex);
                  else beginDuplicateKnob(resolvedIndex);
                },
              });
              setIsContextOpen(false);
              setContextPosition(null);
              return;
            }

            // 플러그인 메뉴 처리
            const pluginItem = pluginKeyMenuItems.find(
              (item) => item.fullId === id,
            );
            if (pluginItem) {
              const keyIndex = resolveContextTarget('key');
              if (keyIndex == null) return;
              const positionForContext =
                useKeyStore.getState().canonicalPositions[selectedKeyType]?.[
                  keyIndex
                ];
              if (!positionForContext) return;
              const context = {
                // 플러그인 메뉴 표면은 canonical 문자열 유지
                keyCode: slotCanonical(
                  useKeyStore.getState().keyMappings[selectedKeyType]?.[
                    keyIndex
                  ] ?? '',
                ),
                id: positionForContext.id,
                index: keyIndex,
                position: positionForContext,
                mode: selectedKeyType,
              };

              try {
                const result = pluginItem.onClick(context);
                if (result && typeof result.then === 'function') {
                  result.catch((error) => {
                    console.error(
                      `[Plugin Menu] Error in '${pluginItem.label}':`,
                      error,
                    );
                  });
                }
              } catch (error) {
                console.error(
                  `[Plugin Menu] Error in '${pluginItem.label}':`,
                  error,
                );
              }

              setIsContextOpen(false);
              setContextPosition(null);
              return;
            }

            const keyIndex = resolveContextTarget('key');
            if (id === 'counterReset') {
              const slot =
                keyIndex != null
                  ? keyMappings[selectedKeyType]?.[keyIndex] ?? ''
                  : '';
              const displayName = slotDisplayName(slot);
              showConfirm(
                t('confirm.resetKeyCounter', { name: displayName }),
                async () => {
                  // 확인 시점 재해석 - 모달이 떠 있는 동안의 재바인딩 반영
                  const confirmIndex = resolveContextTarget('key');
                  if (confirmIndex == null) return;
                  const globalKey = slotCanonical(
                    useKeyStore.getState().keyMappings[selectedKeyType]?.[
                      confirmIndex
                    ] ?? '',
                  );
                  try {
                    await keysApi.resetSingleCounter(
                      selectedKeyType,
                      globalKey,
                    );
                  } catch (error) {
                    console.error('Failed to reset key counter', error);
                  }
                },
                { confirmText: t('confirm.reset') },
              );
            } else {
              executeNativeContextMenuAction({
                menuItemId: id,
                type: 'key',
                mode: selectedKeyType,
                elementId: contextElementId,
                resolvedIndex: keyIndex,
                onDuplicate: beginDuplicateKey,
              });
            }
            setIsContextOpen(false);
            setContextPosition(null);
          }}
        />
      </div>
      {/* 그리드 컨텍스트 메뉴 */}
      <div className="relative">
        <ListPopup
          open={isGridContextOpen}
          ariaLabel={t('common.more')}
          position={gridContextClientPos || undefined}
          onClose={() => {
            setIsGridContextOpen(false);
            setGridContextClientPos(null);
            setGridAddLocalPos(null);
          }}
          items={getGridMenuItems(gridAddLocalPos)}
          onSelect={(id: string) => {
            // 플러그인 메뉴 처리
            const pluginItem = pluginGridMenuItems.find(
              (item) => item.fullId === id,
            );
            if (pluginItem && gridAddLocalPos) {
              const context = {
                position: gridAddLocalPos,
                mode: selectedKeyType,
              };

              // 플러그인 컨텍스트 설정
              const previousPluginId = window.__dmn_current_plugin_id;
              try {
                window.__dmn_current_plugin_id = pluginItem.pluginId;

                const result = pluginItem.onClick(context);
                if (result && typeof result.then === 'function') {
                  result
                    .catch((error) => {
                      console.error(
                        `[Plugin Menu] Error in '${pluginItem.label}':`,
                        error,
                      );
                    })
                    .finally(() => {
                      // 비동기 작업 완료 후 컨텍스트 복원
                      window.__dmn_current_plugin_id = previousPluginId;
                    });
                } else {
                  // 동기 작업이면 즉시 복원
                  window.__dmn_current_plugin_id = previousPluginId;
                }
              } catch (error) {
                console.error(
                  `[Plugin Menu] Error in '${pluginItem.label}':`,
                  error,
                );
                // 에러 발생 시에도 컨텍스트 복원
                window.__dmn_current_plugin_id = previousPluginId;
              }

              setIsGridContextOpen(false);
              setGridContextClientPos(null);
              setGridAddLocalPos(null);
              return;
            }

            // 기본 메뉴 처리
            const addType = gridAddTypeForMenuItem(id);
            if (addType && gridAddLocalPos) {
              addCanvasElementAt(
                canvasActions,
                addType,
                gridAddLocalPos.dx,
                gridAddLocalPos.dy,
              );
            } else if (id === 'tabCss') {
              setIsTabCssModalOpen(true);
            } else if (id === 'tabNote') {
              setIsNoteSettingOpen(false);
              setIsTabNoteModalOpen(true);
            } else if (id === 'resetOverlayPosition') {
              void overlayApi.resetPosition().catch((error) => {
                console.error('Failed to reset overlay position', error);
              });
            } else if (id === 'resetPanelPosition') {
              void panelWindowApi.resetPosition().catch((error) => {
                console.error('Failed to reset panel window position', error);
              });
            }
            setIsGridContextOpen(false);
            setGridContextClientPos(null);
            setGridAddLocalPos(null);
          }}
        />
      </div>
      {/* 미니맵 */}
      {minimapEnabled && (
        <GridMinimap
          positions={positions[selectedKeyType] || []}
          statPositions={statPositions?.[selectedKeyType] || []}
          graphPositions={graphPositions?.[selectedKeyType] || []}
          knobPositions={knobPositions?.[selectedKeyType] || []}
          spritePositions={spritePositions?.[selectedKeyType] || []}
          zoom={zoom}
          panX={panX}
          panY={panY}
          containerRef={gridContainerRef}
          mode={selectedKeyType}
          visible={
            // 기존 로직: 그리드 호버 시에만 표시
            // isGridAreaHovered && !isExtrasPopupOpen && !isExportImportPopupOpen
            // 변경: minimapEnabled가 true면 항상 표시
            true
          }
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onResetZoom={resetZoom}
        />
      )}
      {/* 줌 레벨 표시 - 미니맵 내부로 통합됨 */}
      {/* 탭 CSS 설정 모달 */}
      <TabCssModal
        isOpen={isTabCssModalOpen}
        onClose={() => setIsTabCssModalOpen(false)}
        showAlert={showAlert}
      />
      {/* 탭별 노트 트랙 설정 모달 */}
      <TabNoteSettingModal
        isOpen={isTabNoteModalOpen}
        onClose={() => setIsTabNoteModalOpen(false)}
      />
    </div>
  );
};

export default Grid;
