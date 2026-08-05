import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

declare global {
  interface Window {
    __dmn_current_plugin_id?: string;
  }
}
import { useTranslation } from '@contexts/useTranslation';
import DraggableKey from '@components/shared/Key';
import { getKeyInfoByGlobalKey } from '@utils/core/KeyMaps';
import GridKeySettingModal from './GridKeySettingModal';
import TabCssModal from '../../Modal/content/editors/TabCssModal';
import TabNoteSettingModal from '../../Modal/content/editors/TabNoteSettingModal';
import ListPopup from '../../Modal/ListPopup';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { PluginElementsRenderer } from '@components/shared/PluginElementsRenderer';
import { useGridZoomPan } from '@hooks/Grid/useGridZoomPan';
import { useGridCanvasActions } from '@hooks/Grid/useGridCanvasActions';
import type { DuplicateState } from '@hooks/Grid/useGridCanvasActions';
import GridMinimap from './GridMinimap';
import GridBackground from './GridBackground';
import SmartGuidesOverlay from '../overlays/SmartGuidesOverlay';
import MarqueeSelectionOverlay from '../overlays/MarqueeSelectionOverlay';
import ResizeHandles from '../handles/ResizeHandles';
import GradientAxisOverlay from '../handles/GradientAxisHandle';
import { useGradientEditStore } from '@stores/grid/useGradientEditStore';
import GroupResizeHandles from '../handles/GroupResizeHandles';
import { isElementResizable } from '../handles/groupResizeUtils';
import KeyCounterPreviewLayer from '../layers/KeyCounterPreviewLayer';
import StatCounterLayer from '../layers/StatCounterLayer';
import GraphItem from '../layers/GraphItem';
import KnobItem from '../layers/KnobItem';
import {
  useGridSelectionStore,
  isElementInMarquee,
} from '@stores/grid/useGridSelectionStore';
import { openPropertiesPanelForSelection } from '@stores/grid/usePanelWindowStore';
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
  KeyPositions,
  KeyPosition,
  NoteColor,
  KeyCounterSettings,
  CounterAnimationBezier,
  ImageFit,
} from '@src/types/key/keys';
import type { StatItemPosition } from '@src/types/key/statItems';
import type { GraphItemPosition } from '@src/types/key/graphItems';
import type { KnobItemPosition } from '@src/types/key/knobs';
import type { SaveData } from '@hooks/Modal/useUnifiedKeySettingState';
import { resolveImageSource } from '@utils/core/imageSource';
import {
  DEFAULT_ELEMENT_BG,
  DEFAULT_ELEMENT_BORDER,
  DEFAULT_ELEMENT_BORDER_WIDTH,
  DEFAULT_ELEMENT_FONT,
  DEFAULT_ELEMENT_HAIRLINE,
  DEFAULT_ELEMENT_RADIUS,
  DEFAULT_ELEMENT_SHADOW_SPEC,
  DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
} from '@utils/core/elementDefaults';
import {
  elementShadowToCss,
  resolveElementShadow,
} from '@src/types/key/shadows';
import {
  groupSelectedElements,
  ungroupSelectedElements,
} from '@utils/grid/groupActions';
import {
  composePreviewPositions,
  getPreviewOverlayVersion,
  subscribePreviewOverlay,
} from '@src/renderer/editor/runtime/previewOverlay';
import {
  beginPluginInstancesEditSession,
  endPluginInstancesEditSession,
  rotatePluginInstancesEditSession,
} from '@plugins/runtime/displayElement/instancesCommitQueue';
import {
  beginMixedGestureTransaction,
  cancelUncommittedMixedGestureTransaction,
} from '@plugins/runtime/displayElement/gestureTransaction';

type ToolbarAddRequest = {
  id: number;
  type: 'key' | 'stat' | 'graph' | 'knob';
} | null;

interface SelectedKeyInfo {
  key: string;
  index: number;
}

type KeyPreviewUpdates = Partial<{
  activeImage: string;
  inactiveImage: string;
  soundPath: string;
  soundVolume: number;
  activeTransparent: boolean;
  idleTransparent: boolean;
  width: number;
  height: number;
  className: string;
  backgroundColor: string;
  activeBackgroundColor: string;
  borderColor: string;
  activeBorderColor: string;
  borderWidth: number;
  borderRadius: number;
  fontSize: number;
  fontColor: string;
  activeFontColor: string;
  idleImageFit: ImageFit;
  activeImageFit: ImageFit;
  imageFit: ImageFit;
  useInlineStyles: boolean;
  displayText: string;
}>;

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
  selectedKey: SelectedKeyInfo | null;
  setSelectedKey: (key: SelectedKeyInfo | null) => void;
  keyMappings: KeyMappings;
  positions: KeyPositions;
  onPositionChange: (index: number, dx: number, dy: number) => void;
  onKeyUpdate: (data: Omit<SaveData, 'counter'>) => void;
  onKeyPreview: (index: number, updates: KeyPreviewUpdates) => void;
  onNoteColorUpdate: (
    index: number,
    noteColor: NoteColor,
    noteOpacity: number,
    noteGlowEnabled: boolean,
    noteGlowSize: number,
    noteGlowOpacity: number,
    noteGlowColor: NoteColor,
    noteAutoYCorrection: boolean,
    noteEffectEnabled: boolean,
  ) => void;
  onNoteColorPreview: (
    index: number,
    noteColor: NoteColor,
    noteOpacity: number,
    noteGlowEnabled: boolean,
    noteGlowSize: number,
    noteGlowOpacity: number,
    noteGlowColor: NoteColor,
    noteAutoYCorrection: boolean,
    noteEffectEnabled: boolean,
  ) => void;
  onCounterPreview: (index: number, payload: KeyCounterSettings) => void;
  onKeyDelete: (index: number) => void;
  onAddKeyAt: (dx: number, dy: number) => void;
  onKeyDuplicate: (sourceIndex: number, dx: number, dy: number) => void;
  onMoveToFront: (index: number) => void | Promise<void>;
  onMoveToBack: (index: number) => void | Promise<void>;
  onMoveForward: (index: number) => void | Promise<void>;
  onMoveBackward: (index: number) => void | Promise<void>;
  color: string;
  activeTool: string;
  shouldSkipModalAnimation: boolean;
  onModalAnimationConsumed: (() => void) | undefined;
  onUndo: () => void;
  onRedo: () => void;
  toolbarAddRequest: ToolbarAddRequest;
  onToolbarAddConsumed: (() => void) | undefined;
  isNoteSettingOpen: boolean;
  setIsNoteSettingOpen: (open: boolean) => void;
}

function getStatTypeLabel(type: string): string {
  if (type === 'kps') return 'KPS';
  if (type === 'kpsAvg') return 'AVG';
  if (type === 'kpsMax') return 'MAX';
  if (type === 'total') return 'Total';
  return String(type || '');
}

const Grid = ({
  showConfirm,
  showAlert,
  selectedKey,
  setSelectedKey,
  keyMappings,
  positions,
  onPositionChange,
  onKeyUpdate,
  onKeyPreview,
  onNoteColorUpdate: _onNoteColorUpdate,
  onNoteColorPreview,
  onCounterPreview,
  onKeyDelete,
  onAddKeyAt,
  onKeyDuplicate,
  onMoveToFront,
  onMoveToBack,
  onMoveForward,
  onMoveBackward,
  color,
  activeTool,
  shouldSkipModalAnimation,
  onModalAnimationConsumed,
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
    (state) => state.gridSettings?.gridSnapSize || 5,
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

  // 컨텍스트 메뉴 훅 사용
  const {
    getKeyMenuItems,
    getStatMenuItems,
    getGraphMenuItems,
    getKnobMenuItems,
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
  const selectedDragGestureIdRef = useRef<string | null>(null);

  const rotatePluginElementSessions = (fullIds: string[]) => {
    const selectedPluginIds = new Set(fullIds);
    const pluginIds = new Set(
      usePluginDisplayElementStore
        .getState()
        .elements.filter((element) => selectedPluginIds.has(element.fullId))
        .map((element) => element.pluginId),
    );
    pluginIds.forEach((pluginId) => {
      rotatePluginInstancesEditSession(pluginId);
    });
  };

  const beginSelectedPluginInstancesDrag = () => {
    const gestureId = crypto.randomUUID();
    selectedDragGestureIdRef.current = gestureId;
    const selectedPluginElementIds = new Set(
      useGridSelectionStore
        .getState()
        .selectedElements.filter((element) => element.type === 'plugin')
        .map((element) => element.id),
    );
    const tokens = new Map<string, string>();
    usePluginDisplayElementStore
      .getState()
      .elements.filter((element) =>
        selectedPluginElementIds.has(element.fullId),
      )
      .forEach((element) => {
        if (!tokens.has(element.pluginId)) {
          tokens.set(
            element.pluginId,
            beginPluginInstancesEditSession(element.pluginId, gestureId),
          );
        }
      });
    if (
      tokens.size > 0 &&
      useGridSelectionStore
        .getState()
        .selectedElements.some((element) => element.type !== 'plugin')
    ) {
      beginMixedGestureTransaction(gestureId, [...tokens.keys()]);
    }
    return () => {
      tokens.forEach((token, pluginId) => {
        endPluginInstancesEditSession(pluginId, token);
      });
      // 종료 경로가 혼합 커밋을 타지 않은 경우 staged 잔존으로 barrier가
      // 영구 대기하지 않도록 미커밋 staged만 정산
      cancelUncommittedMixedGestureTransaction(gestureId);
      if (selectedDragGestureIdRef.current === gestureId) {
        selectedDragGestureIdRef.current = null;
      }
    };
  };

  // 내장 통계 요소(Stat Items) 위치 정보
  const canonicalStatPositions = useStatItemStore((state) => state.positions);
  const canonicalGraphPositions = useGraphItemStore((state) => state.positions);
  const canonicalKnobPositions = useKnobItemStore((state) => state.positions);
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

  // 선택 관련 로직 훅 사용
  const {
    moveSelectedElements,
    deleteSelectedElements,
    copySelectedElements,
    pasteElements,
    syncSelectedElementsToOverlay,
  } = useGridSelection({
    selectedElements,
    selectedKeyType,
    keyMappings,
    positions,
  });
  const commitSelectedElementsDrag = () => {
    syncSelectedElementsToOverlay(
      selectedDragGestureIdRef.current ?? undefined,
    );
  };

  // 마퀴 선택 훅 사용
  const { isMarqueeSelecting: _isMarqueeSelecting, startMarqueeSelection } =
    useGridMarquee({
      positions,
      statPositions,
      graphPositions,
      knobPositions,
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
    onResizeEnd: syncSelectedElementsToOverlay,
    getOtherElements,
  });

  // 선택된 요소의 z-order 조작 핸들러
  const handleSelectedMoveForward = async () => {
    if (selectedElements.length !== 1) return;
    const selected = selectedElements[0];
    if (selected.type === 'key') {
      await onMoveForward(selected.index);
    } else if (selected.type === 'stat') {
      await moveStatForward(selected.index);
    } else if (selected.type === 'plugin') {
      rotatePluginElementSessions([selected.id]);
      usePluginDisplayElementStore.getState().bringForward(selected.id);
    } else if (selected.type === 'graph') {
      await moveGraphForward(selected.index);
    } else if (selected.type === 'knob') {
      await moveKnobForward(selected.index);
    }
    syncSelectedElementsToOverlay();
  };

  const handleSelectedMoveBackward = async () => {
    if (selectedElements.length !== 1) return;
    const selected = selectedElements[0];
    if (selected.type === 'key') {
      await onMoveBackward(selected.index);
    } else if (selected.type === 'stat') {
      await moveStatBackward(selected.index);
    } else if (selected.type === 'plugin') {
      rotatePluginElementSessions([selected.id]);
      usePluginDisplayElementStore.getState().sendBackward(selected.id);
    } else if (selected.type === 'graph') {
      await moveGraphBackward(selected.index);
    } else if (selected.type === 'knob') {
      await moveKnobBackward(selected.index);
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
  const [contextType, setContextType] = useState<string>('key');
  const contextRef = useRef<HTMLElement | null>(null);
  const [contextPosition, setContextPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const keyRefs = useRef<(HTMLElement | null)[]>([]);
  const statRefs = useRef<(HTMLElement | null)[]>([]);
  const graphRefs = useRef<(HTMLElement | null)[]>([]);
  const knobRefs = useRef<(HTMLElement | null)[]>([]);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [duplicateState, setDuplicateState] = useState<DuplicateState | null>(
    null,
  );
  const [duplicateCursor, setDuplicateCursor] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const lastMousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const mixedSelectionMenuItems = (() => {
    const items = [
      { id: 'delete', label: t('contextMenu.deleteSelected') },
      { id: 'duplicate', label: t('contextMenu.duplicateSelected') },
    ];

    if (selectedElements.length >= 2) {
      // 선택된 요소들의 그룹 상태 확인
      const modeKeyPos = positions[selectedKeyType] || [];
      const modeStatPos =
        useStatItemStore.getState().positions[selectedKeyType] || [];
      const modeGraphPos =
        useGraphItemStore.getState().positions[selectedKeyType] || [];
      const modeKnobPos =
        useKnobItemStore.getState().positions[selectedKeyType] || [];

      let anyInGroup = false;
      let allInSameGroup = true;
      let firstGroupId;
      let first = true;

      selectedElements.forEach((el) => {
        let gid;
        if (el.type === 'key' && el.index !== undefined) {
          gid = modeKeyPos[el.index]?.groupId;
        } else if (el.type === 'stat' && el.index !== undefined) {
          gid = modeStatPos[el.index]?.groupId;
        } else if (el.type === 'graph' && el.index !== undefined) {
          gid = modeGraphPos[el.index]?.groupId;
        } else if (el.type === 'knob' && el.index !== undefined) {
          gid = modeKnobPos[el.index]?.groupId;
        }
        if (gid) anyInGroup = true;
        if (first) {
          firstGroupId = gid;
          first = false;
        } else if (gid !== firstGroupId) allInSameGroup = false;
      });

      if (anyInGroup && allInSameGroup && firstGroupId) {
        // 모두 같은 그룹 → 그룹 해제만
        items.push({ id: 'ungroupSelected', label: t('contextMenu.ungroup') });
      } else if (!anyInGroup) {
        // 그룹 없음 → 그룹화만
        items.push({
          id: 'groupSelected',
          label: t('contextMenu.groupSelected'),
        });
      } else {
        // 혼합 → 둘 다
        items.push({
          id: 'groupSelected',
          label: t('contextMenu.groupSelected'),
        });
        items.push({ id: 'ungroupSelected', label: t('contextMenu.ungroup') });
      }
    }

    items.push({ id: 'bringToFront', label: t('contextMenu.bringToFront') });
    items.push({ id: 'sendToBack', label: t('contextMenu.sendToBack') });

    return items;
  })();

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

  const shouldOpenMixedSelectionMenu = (clickedId: string) => {
    if (selectedElements.length <= 1) return false;
    if (!selectedElements.some((el) => el.id === clickedId)) return false;
    return true;
  };

  // 클라이언트 좌표를 그리드 좌표로 변환 (줌/팬 반영)
  const computeSnappedCursorFromClient = (clientX: number, clientY: number) => {
    const gridCoords = clientToGridCoords(clientX, clientY);
    if (!gridCoords) return null;
    return snapCursorToGrid(gridCoords.x, gridCoords.y);
  };

  // 캔버스 요소 액션 (useGridCanvasActions에서 위임)
  const {
    deleteStatAtIndex,
    moveStatToFront,
    moveStatToBack,
    moveStatForward,
    moveStatBackward,
    addStatAtPosition,
    placeDuplicateStat,
    deleteGraphAtIndex,
    moveGraphToFront,
    moveGraphToBack,
    moveGraphForward,
    moveGraphBackward,
    addGraphAtPosition,
    placeDuplicateGraph,
    deleteKnobAtIndex,
    moveKnobToFront,
    moveKnobToBack,
    moveKnobForward,
    moveKnobBackward,
    addKnobAtPosition,
    placeDuplicateKnob,
  } = canvasActions;

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

  const duplicateSelectedFromContextMenu = async () => {
    copySelectedElements();
    await pasteElements();
  };

  const moveSelectedToFront = async () => {
    if (selectedElements.length === 0) return;

    rotatePluginElementSessions(
      selectedElements
        .filter((element) => element.type === 'plugin')
        .map((element) => element.id),
    );

    for (const el of selectedElements) {
      if (el.type === 'key' && el.index !== undefined) {
        if (typeof onMoveToFront === 'function') {
          await onMoveToFront(el.index);
        }
      } else if (el.type === 'stat' && el.index !== undefined) {
        moveStatToFront(el.index);
      } else if (el.type === 'graph' && el.index !== undefined) {
        moveGraphToFront(el.index);
      } else if (el.type === 'knob' && el.index !== undefined) {
        moveKnobToFront(el.index);
      } else if (el.type === 'plugin') {
        usePluginDisplayElementStore.getState().bringToFront(el.id);
      }
    }

    syncSelectedElementsToOverlay();
  };

  const moveSelectedToBack = async () => {
    if (selectedElements.length === 0) return;

    rotatePluginElementSessions(
      selectedElements
        .filter((element) => element.type === 'plugin')
        .map((element) => element.id),
    );

    for (const el of selectedElements) {
      if (el.type === 'key' && el.index !== undefined) {
        if (typeof onMoveToBack === 'function') {
          await onMoveToBack(el.index);
        }
      } else if (el.type === 'stat' && el.index !== undefined) {
        moveStatToBack(el.index);
      } else if (el.type === 'graph' && el.index !== undefined) {
        moveGraphToBack(el.index);
      } else if (el.type === 'knob' && el.index !== undefined) {
        moveKnobToBack(el.index);
      } else if (el.type === 'plugin') {
        usePluginDisplayElementStore.getState().sendToBack(el.id);
      }
    }

    syncSelectedElementsToOverlay();
  };

  const addKeyAtPosition = (dx: number, dy: number) => {
    if (typeof onAddKeyAt === 'function') {
      onAddKeyAt(dx, dy);
    }
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
        : { width: 60, height: 60 };
    const targetPos = getViewportCenterSnappedPosition(
      defaultSize.width,
      defaultSize.height,
    );
    if (targetPos) {
      if (toolbarAddRequest.type === 'key') {
        addKeyAtPosition(targetPos.dx, targetPos.dy);
      } else if (toolbarAddRequest.type === 'stat') {
        addStatAtPosition(targetPos.dx, targetPos.dy);
      } else if (toolbarAddRequest.type === 'graph') {
        addGraphAtPosition(targetPos.dx, targetPos.dy);
      } else if (toolbarAddRequest.type === 'knob') {
        addKnobAtPosition(targetPos.dx, targetPos.dy);
      }
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

  // 탭 변경 시 선택 해제
  useEffect(() => {
    if (previousSelectedKeyTypeRef.current !== selectedKeyType) {
      clearSelection();
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
  const selectElementWithGroup = (
    type: 'key' | 'stat' | 'graph' | 'knob',
    index: number,
  ) => {
    if (isContextOpen) {
      setIsContextOpen(false);
      setContextPosition(null);
    }
    clearSelection();
    toggleSelection({ type, id: `${type}-${index}`, index });

    // 그룹 ID 조회
    let groupId: string | undefined;
    if (type === 'key') {
      groupId = positions[selectedKeyType]?.[index]?.groupId;
    } else if (type === 'stat') {
      groupId =
        useStatItemStore.getState().positions[selectedKeyType]?.[index]
          ?.groupId;
    } else if (type === 'graph') {
      groupId =
        useGraphItemStore.getState().positions[selectedKeyType]?.[index]
          ?.groupId;
    } else {
      groupId =
        useKnobItemStore.getState().positions[selectedKeyType]?.[index]
          ?.groupId;
    }

    if (groupId) {
      // 같은 그룹의 모든 요소 선택
      (positions[selectedKeyType] || []).forEach((p, i) => {
        if (p?.groupId === groupId && !(type === 'key' && i === index)) {
          toggleSelection({ type: 'key', id: `key-${i}`, index: i });
        }
      });
      const statPos =
        useStatItemStore.getState().positions[selectedKeyType] || [];
      statPos.forEach((p, i) => {
        if (p?.groupId === groupId && !(type === 'stat' && i === index)) {
          toggleSelection({ type: 'stat', id: `stat-${i}`, index: i });
        }
      });
      const graphPos =
        useGraphItemStore.getState().positions[selectedKeyType] || [];
      graphPos.forEach((p, i) => {
        if (p?.groupId === groupId && !(type === 'graph' && i === index)) {
          toggleSelection({ type: 'graph', id: `graph-${i}`, index: i });
        }
      });
      const knobPos =
        useKnobItemStore.getState().positions[selectedKeyType] || [];
      knobPos.forEach((p, i) => {
        if (p?.groupId === groupId && !(type === 'knob' && i === index)) {
          toggleSelection({ type: 'knob', id: `knob-${i}`, index: i });
        }
      });
    }
  };

  // 더블클릭 편집 진입 — 대상이 다중 선택의 멤버면 선택을 보존해 배치 편집으로,
  // 아니면 해당 요소(+그룹)만 선택해 단일 편집으로 property 페이지를 연다
  const openElementEditor = (
    type: 'key' | 'stat' | 'graph' | 'knob',
    index: number,
  ) => {
    const { selectedElements: currentSelection } =
      useGridSelectionStore.getState();
    const isMultiMember =
      currentSelection.length > 1 &&
      currentSelection.some((el) => el.id === `${type}-${index}`);
    if (!isMultiMember) {
      selectElementWithGroup(type, index);
    }
    openPropertiesPanelForSelection();
  };

  // 요소 컨텍스트 메뉴 열기
  const openElementContextMenu = (
    type: 'key' | 'stat' | 'graph' | 'knob',
    index: number,
    clientX: number,
    clientY: number,
    ref: HTMLElement | null,
  ) => {
    if (duplicateState) {
      setDuplicateState(null);
      setDuplicateCursor(null);
    }
    const clickedId = `${type}-${index}`;
    if (shouldOpenMixedSelectionMenu(clickedId)) {
      openMixedSelectionContextMenu(clientX, clientY, ref);
      return;
    }
    setContextType(type);
    setContextIndex(index);
    contextRef.current = ref;
    setContextPosition({ x: clientX, y: clientY });
    setIsContextOpen(true);
  };

  const renderKeys = () => {
    if (!positions[selectedKeyType]) return null;

    return positions[selectedKeyType].map(
      (position: KeyPosition, index: number) => (
        <DraggableKey
          key={`${selectedKeyType}-${index}`}
          index={index}
          position={position}
          keyName={keyMappings[selectedKeyType]?.[index] || ''}
          onPositionChange={onPositionChange}
          zIndex={position.zIndex ?? index}
          onClick={() => {
            selectElementWithGroup('key', index);
            // 마지막 선택 키 좌표 저장 (Shift+클릭 범위 선택용)
            const pos = positions[selectedKeyType]?.[index];
            if (pos) {
              setLastSelectedKeyBounds({
                x: pos.dx,
                y: pos.dy,
                width: pos.width || 60,
                height: pos.height || 60,
              });
            }
          }}
          onDoubleClick={() => openElementEditor('key', index)}
          onCtrlClick={() => {
            // 다중 선택: 기존 선택 유지하면서 추가/제거
            toggleSelection({ type: 'key', id: `key-${index}`, index });
            // 마지막 선택 키 좌표 저장 (Shift+클릭 범위 선택용)
            const pos = positions[selectedKeyType]?.[index];
            if (pos) {
              setLastSelectedKeyBounds({
                x: pos.dx,
                y: pos.dy,
                width: pos.width || 60,
                height: pos.height || 60,
              });
            }
          }}
          onShiftClick={() => {
            // 좌표 기반 범위 선택
            if (!lastSelectedKeyBounds) {
              // 이전 선택이 없으면 단일 선택처럼 동작
              clearSelection();
              toggleSelection({ type: 'key', id: `key-${index}`, index });
              const pos = positions[selectedKeyType]?.[index];
              if (pos) {
                setLastSelectedKeyBounds({
                  x: pos.dx,
                  y: pos.dy,
                  width: pos.width || 60,
                  height: pos.height || 60,
                });
              }
              return;
            }

            const clickedPos = positions[selectedKeyType]?.[index];
            if (!clickedPos) return;

            // 두 키 사이의 사각형 영역 계산
            const clickedBounds = {
              x: clickedPos.dx,
              y: clickedPos.dy,
              width: clickedPos.width || 60,
              height: clickedPos.height || 60,
            };

            const minX = Math.min(lastSelectedKeyBounds.x, clickedBounds.x);
            const maxX = Math.max(
              lastSelectedKeyBounds.x + lastSelectedKeyBounds.width,
              clickedBounds.x + clickedBounds.width,
            );
            const minY = Math.min(lastSelectedKeyBounds.y, clickedBounds.y);
            const maxY = Math.max(
              lastSelectedKeyBounds.y + lastSelectedKeyBounds.height,
              clickedBounds.y + clickedBounds.height,
            );

            const rangeRect = {
              left: minX,
              top: minY,
              width: maxX - minX,
              height: maxY - minY,
            };

            // 범위 내 모든 키 선택
            const newSelectedElements = [];
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
                  id: `key-${i}`,
                  index: i,
                });
              }
            });

            // 범위 내 플러그인 요소도 선택
            pluginElements.forEach((el) => {
              const belongsToCurrentTab =
                !el.tabId || el.tabId === selectedKeyType;
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

            // 범위 내 통계 요소도 선택
            (statPositions?.[selectedKeyType] || []).forEach((pos, i) => {
              if (!pos || pos.hidden) return;
              const elementBounds = {
                x: pos.dx,
                y: pos.dy,
                width: pos.width || 60,
                height: pos.height || 60,
              };
              if (isElementInMarquee(elementBounds, rangeRect)) {
                newSelectedElements.push({
                  type: 'stat',
                  id: `stat-${i}`,
                  index: i,
                });
              }
            });

            // 범위 내 그래프 요소도 선택
            (graphPositions?.[selectedKeyType] || []).forEach((pos, i) => {
              if (!pos || pos.hidden) return;
              const elementBounds = {
                x: pos.dx,
                y: pos.dy,
                width: pos.width || 200,
                height: pos.height || 100,
              };
              if (isElementInMarquee(elementBounds, rangeRect)) {
                newSelectedElements.push({
                  type: 'graph',
                  id: `graph-${i}`,
                  index: i,
                });
              }
            });

            // 범위 내 노브 요소도 선택
            (knobPositions?.[selectedKeyType] || []).forEach((pos, i) => {
              if (!pos || pos.hidden) return;
              const elementBounds = {
                x: pos.dx,
                y: pos.dy,
                width: pos.width || 80,
                height: pos.height || 80,
              };
              if (isElementInMarquee(elementBounds, rangeRect)) {
                newSelectedElements.push({
                  type: 'knob',
                  id: `knob-${i}`,
                  index: i,
                });
              }
            });

            setSelectedElements(newSelectedElements);
          }}
          isSelected={selectedElements.some(
            (el) => el.type === 'key' && el.index === index,
          )}
          selectedElements={selectedElements}
          onMultiDrag={(deltaX, deltaY) =>
            moveSelectedElements(deltaX, deltaY, undefined, false)
          }
          onMultiDragStart={beginSelectedPluginInstancesDrag}
          onMultiDragEnd={commitSelectedElementsDrag}
          activeTool={activeTool}
          onEraserClick={() => {
            const globalKey = keyMappings[selectedKeyType]?.[index] || '';
            const displayName =
              getKeyInfoByGlobalKey(globalKey)?.displayName || globalKey;
            showConfirm(
              t('confirm.removeKey', { name: displayName }),
              () => onKeyDelete(index),
              { confirmText: t('confirm.remove') },
            );
          }}
          onContextMenu={(e) => {
            openElementContextMenu(
              'key',
              index,
              e.clientX,
              e.clientY,
              keyRefs.current[index] || null,
            );
          }}
          setReferenceRef={(node) => {
            keyRefs.current[index] = node;
          }}
          zoom={zoom}
          panX={panX}
          panY={panY}
          isViewportTransforming={isTransforming}
          counterEnabled={keyCounterEnabled}
          counterPreviewValue={0}
        />
      ),
    );
  };

  const renderStatItems = () => {
    const items = statPositions?.[selectedKeyType] || [];
    if (!items.length) return null;

    const handleStatPositionChange = (
      index: number,
      dx: number,
      dy: number,
    ) => {
      const current = useStatItemStore.getState().positions;
      const tabPositions = current[selectedKeyType] || [];
      const prev = tabPositions[index];
      if (!prev) return;
      if (prev.dx === dx && prev.dy === dy) return;

      const nextTabPositions = tabPositions.map((pos, i) =>
        i === index ? { ...pos, dx, dy } : pos,
      );
      const nextPositions = { ...current, [selectedKeyType]: nextTabPositions };

      useStatItemStore.getState().setPositions(nextPositions);
      window.api.statItems.updatePositions(nextPositions).catch((error) => {
        console.error('Failed to update stat item positions', error);
      });
    };

    return items.map((position: StatItemPosition, index: number) => (
      <DraggableKey
        key={`stat-${selectedKeyType}-${index}`}
        index={index}
        elementId={`stat-${index}`}
        position={position}
        keyName={getStatTypeLabel(position.statType)}
        onPositionChange={handleStatPositionChange}
        zIndex={position.zIndex ?? index}
        onClick={() => {
          selectElementWithGroup('stat', index);
        }}
        onDoubleClick={() => openElementEditor('stat', index)}
        onCtrlClick={() => {
          toggleSelection({ type: 'stat', id: `stat-${index}`, index });
        }}
        onShiftClick={() => {
          // 통계 요소는 범위 선택 대상이 아니므로 Ctrl+클릭과 동일하게 처리
          toggleSelection({ type: 'stat', id: `stat-${index}`, index });
        }}
        isSelected={selectedElements.some(
          (el) => el.type === 'stat' && el.index === index,
        )}
        selectedElements={selectedElements}
        onMultiDrag={(deltaX, deltaY) =>
          moveSelectedElements(deltaX, deltaY, undefined, false)
        }
        onMultiDragStart={beginSelectedPluginInstancesDrag}
        onMultiDragEnd={commitSelectedElementsDrag}
        activeTool={activeTool}
        onEraserClick={() => {
          const displayName = getStatTypeLabel(position.statType);
          showConfirm(
            t('confirm.removeStat', { name: displayName }),
            () => deleteStatAtIndex(index),
            { confirmText: t('confirm.remove') },
          );
        }}
        onContextMenu={(e) => {
          openElementContextMenu(
            'stat',
            index,
            e.clientX,
            e.clientY,
            statRefs.current[index] || null,
          );
        }}
        zoom={zoom}
        panX={panX}
        panY={panY}
        isViewportTransforming={isTransforming}
        counterEnabled={true}
        counterPreviewValue={0}
        setReferenceRef={(node) => {
          statRefs.current[index] = node;
        }}
      />
    ));
  };

  const renderGraphItems = () => {
    const items = graphPositions?.[selectedKeyType] || [];
    if (!items.length) return null;

    const handleGraphPositionChange = (
      index: number,
      dx: number,
      dy: number,
    ) => {
      const current = useGraphItemStore.getState().positions;
      const tabPositions = current[selectedKeyType] || [];
      const prev = tabPositions[index];
      if (!prev) return;
      if (prev.dx === dx && prev.dy === dy) return;

      const nextTabPositions = tabPositions.map((pos, i) =>
        i === index ? { ...pos, dx, dy } : pos,
      );
      const nextPositions = { ...current, [selectedKeyType]: nextTabPositions };

      useGraphItemStore.getState().setPositions(nextPositions);
      window.api.graphItems.updatePositions(nextPositions).catch((error) => {
        console.error('Failed to update graph item positions', error);
      });
    };

    return items.map((position, index) => (
      <GraphItem
        key={`graph-${selectedKeyType}-${index}`}
        index={index}
        elementId={`graph-${index}`}
        position={position}
        onPositionChange={handleGraphPositionChange}
        zIndex={position.zIndex ?? index}
        onClick={() => {
          selectElementWithGroup('graph', index);
        }}
        onDoubleClick={() => openElementEditor('graph', index)}
        onCtrlClick={() => {
          toggleSelection({ type: 'graph', id: `graph-${index}`, index });
        }}
        onShiftClick={() => {
          toggleSelection({ type: 'graph', id: `graph-${index}`, index });
        }}
        isSelected={selectedElements.some(
          (el) => el.type === 'graph' && el.index === index,
        )}
        selectedElements={selectedElements}
        onMultiDrag={(deltaX, deltaY) =>
          moveSelectedElements(deltaX, deltaY, undefined, false)
        }
        onMultiDragStart={beginSelectedPluginInstancesDrag}
        onMultiDragEnd={commitSelectedElementsDrag}
        activeTool={activeTool}
        onEraserClick={() => {
          const displayName = getStatTypeLabel(position.statType);
          showConfirm(
            t('confirm.removeGraph', { name: displayName }),
            () => deleteGraphAtIndex(index),
            { confirmText: t('confirm.remove') },
          );
        }}
        onContextMenu={(e) => {
          openElementContextMenu(
            'graph',
            index,
            e.clientX,
            e.clientY,
            graphRefs.current[index] || null,
          );
        }}
        zoom={zoom}
        panX={panX}
        panY={panY}
        isViewportTransforming={isTransforming}
        setReferenceRef={(node) => {
          graphRefs.current[index] = node;
        }}
      />
    ));
  };

  const renderKnobItems = () => {
    const items = knobPositions?.[selectedKeyType] || [];
    if (!items.length) return null;

    const handleKnobPositionChange = (
      index: number,
      dx: number,
      dy: number,
    ) => {
      const current = useKnobItemStore.getState().positions;
      const tabPositions = current[selectedKeyType] || [];
      const prev = tabPositions[index];
      if (!prev) return;
      if (prev.dx === dx && prev.dy === dy) return;

      const nextTabPositions = tabPositions.map((pos, i) =>
        i === index ? { ...pos, dx, dy } : pos,
      );
      const nextPositions = { ...current, [selectedKeyType]: nextTabPositions };

      useKnobItemStore.getState().setPositions(nextPositions);
      window.api.knobItems.updatePositions(nextPositions).catch((error) => {
        console.error('Failed to update knob item positions', error);
      });
    };

    return items.map((position, index) => (
      <KnobItem
        key={`knob-${selectedKeyType}-${index}`}
        index={index}
        elementId={`knob-${index}`}
        position={position}
        onPositionChange={handleKnobPositionChange}
        zIndex={position.zIndex ?? index}
        onClick={() => {
          selectElementWithGroup('knob', index);
        }}
        onDoubleClick={() => openElementEditor('knob', index)}
        onCtrlClick={() => {
          toggleSelection({ type: 'knob', id: `knob-${index}`, index });
        }}
        onShiftClick={() => {
          toggleSelection({ type: 'knob', id: `knob-${index}`, index });
        }}
        isSelected={selectedElements.some(
          (el) => el.type === 'knob' && el.index === index,
        )}
        selectedElements={selectedElements}
        onMultiDrag={(deltaX, deltaY) =>
          moveSelectedElements(deltaX, deltaY, undefined, false)
        }
        onMultiDragStart={beginSelectedPluginInstancesDrag}
        onMultiDragEnd={commitSelectedElementsDrag}
        activeTool={activeTool}
        onEraserClick={() => {
          showConfirm(
            t('confirm.removeKnob', { name: 'Knob' }),
            () => deleteKnobAtIndex(index),
            { confirmText: t('confirm.remove') },
          );
        }}
        onContextMenu={(e) => {
          openElementContextMenu(
            'knob',
            index,
            e.clientX,
            e.clientY,
            knobRefs.current[index] || null,
          );
        }}
        zoom={zoom}
        panX={panX}
        panY={panY}
        isViewportTransforming={isTransforming}
        setReferenceRef={(node) => {
          knobRefs.current[index] = node;
        }}
      />
    ));
  };

  const renderDuplicateGhost = () => {
    if (!duplicateState || !duplicateCursor) return null;

    if (duplicateState.elementType === 'graph') {
      const width = duplicateState.position?.width || 200;
      const height = duplicateState.position?.height || 100;
      const offsetX = duplicateCursor.x - width / 2;
      const offsetY = duplicateCursor.y - height / 2;
      return (
        <div
          className="absolute pointer-events-none select-none"
          style={{
            width: `${width}px`,
            height: `${height}px`,
            transform: `translate3d(${offsetX}px, ${offsetY}px, 0)`,
            background: DEFAULT_ELEMENT_BG,
            border: `1px solid ${DEFAULT_ELEMENT_HAIRLINE}`,
            borderRadius: `${DEFAULT_ELEMENT_RADIUS}px`,
            opacity: 0.5,
            zIndex: 1000,
          }}
        />
      );
    }

    const {
      position: {
        width = 60,
        height = 60,
        inactiveImage,
        activeImage,
        className,
        shadow,
        activeShadow,
      },
      keyName,
    } = duplicateState;
    const previewImage =
      resolveImageSource(inactiveImage) ||
      resolveImageSource(activeImage) ||
      '';
    const backgroundColor = previewImage ? 'transparent' : DEFAULT_ELEMENT_BG;
    const previewShadow = elementShadowToCss(
      resolveElementShadow({
        active: false,
        shadow,
        activeShadow,
        defaultShadow: DEFAULT_ELEMENT_SHADOW_SPEC,
        defaultActiveShadow: DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
        suppressDefault: Boolean(previewImage),
      }),
    );
    const displayName =
      getKeyInfoByGlobalKey(keyName)?.displayName || keyName || '';

    // 키의 중심이 마우스에 위치하도록 오프셋 계산
    const offsetX = duplicateCursor.x - width / 2;
    const offsetY = duplicateCursor.y - height / 2;

    return (
      <div
        className={`absolute pointer-events-none select-none ${
          className || ''
        }`}
        style={{
          width: `${width}px`,
          height: `${height}px`,
          transform: `translate3d(${offsetX}px, ${offsetY}px, 0)`,
          backgroundColor,
          borderRadius: `${DEFAULT_ELEMENT_RADIUS}px`,
          border: `${DEFAULT_ELEMENT_BORDER_WIDTH}px solid ${DEFAULT_ELEMENT_BORDER}`,
          boxShadow: previewShadow,
          overflow: 'hidden',
          opacity: 0.5,
          zIndex: 1000,
        }}
      >
        {previewImage ? (
          <img
            src={previewImage}
            alt=""
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
              pointerEvents: 'none',
              userSelect: 'none',
            }}
            draggable={false}
          />
        ) : (
          <div
            className="flex items-center justify-center h-full font-bold leading-none text-safe-inline"
            style={{
              color: `var(--key-text-color, ${DEFAULT_ELEMENT_FONT})`,
              willChange: 'auto',
              contain: 'layout style paint',
            }}
          >
            {displayName}
          </div>
        )}
      </div>
    );
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
      className="relative w-full h-full bg-panel rounded-[0px] overflow-hidden"
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
        setGridAddLocalPos({
          dx: Math.round(gridCoords.x),
          dy: Math.round(gridCoords.y),
        });
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
          const type = duplicateState.elementType || 'key';

          if (type === 'key' && typeof onKeyDuplicate === 'function') {
            onKeyDuplicate(
              duplicateState.sourceIndex,
              snapped.x - width / 2,
              snapped.y - height / 2,
            );
          } else if (type === 'stat') {
            placeDuplicateStat(
              duplicateState.position as StatItemPosition,
              snapped.x - width / 2,
              snapped.y - height / 2,
            );
          } else if (type === 'graph') {
            placeDuplicateGraph(
              duplicateState.position as GraphItemPosition,
              snapped.x - width / 2,
              snapped.y - height / 2,
            );
          } else if (type === 'knob') {
            placeDuplicateKnob(
              duplicateState.position as KnobItemPosition,
              snapped.x - width / 2,
              snapped.y - height / 2,
            );
          }
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
      {/* 줌/팬이 적용되는 콘텐츠 영역 */}
      <div
        key={selectedKeyType}
        ref={gridContentRef}
        className="absolute"
        style={{
          transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
          transformOrigin: '0 0',
          willChange: isTransforming ? 'transform' : 'auto',
        }}
      >
        {renderKeys()}
        {renderStatItems()}
        {renderGraphItems()}
        {renderKnobItems()}
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
        {renderDuplicateGhost()}
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
            if (!shouldOpenMixedSelectionMenu(elementId)) return false;
            openMixedSelectionContextMenu(
              clientX,
              clientY,
              referenceElement || null,
            );
            return true;
          }}
          onMultiDrag={(deltaX, deltaY) =>
            moveSelectedElements(deltaX, deltaY, undefined, false)
          }
          onMultiDragStart={beginSelectedPluginInstancesDrag}
          onMultiDragEnd={commitSelectedElementsDrag}
        />
      </div>
      {/* 스마트 가이드 오버레이 */}
      <SmartGuidesOverlay zoom={zoom} panX={panX} panY={panY} />
      {/* 마퀴 선택 오버레이 */}
      <MarqueeSelectionOverlay zoom={zoom} panX={panX} panY={panY} />
      {/* 선택된 요소 표시 - 그룹 리사이즈 중에는 개별 테두리 숨김 (흔들림 방지) */}
      {selectedElements.map((el, _idx) => {
        // 온캔버스 그라데이션 편집 중에는 선택 테두리 숨김 (축·스톱만 표시)
        if (hasGradientEditSession) return null;
        // 그룹 리사이즈 중에는 개별 요소 테두리 숨김 (스냅으로 인한 흔들림 방지)
        if (selectedElements.length > 1 && previewElementBounds) {
          return null;
        }

        // 다중 선택 시 리사이즈 불가능한 요소는 파란 선 대신 주황색 선으로 표시됨 (GroupResizeHandles에서 처리)
        if (selectedElements.length > 1) {
          const isResizable = isElementResizable(
            el,
            positions,
            statPositions,
            graphPositions,
            knobPositions,
            selectedKeyType,
            pluginElements,
          );
          if (!isResizable) {
            return null; // 주황색 선은 GroupResizeHandles에서 표시
          }
        }

        let bounds = null;
        if (el.type === 'key' && el.index !== undefined) {
          const pos = positions[selectedKeyType]?.[el.index];
          if (pos) {
            bounds = {
              x: pos.dx,
              y: pos.dy,
              width: pos.width || 60,
              height: pos.height || 60,
            };
          }
        } else if (el.type === 'stat' && el.index !== undefined) {
          const pos = statPositions?.[selectedKeyType]?.[el.index];
          if (pos) {
            bounds = {
              x: pos.dx,
              y: pos.dy,
              width: pos.width || 60,
              height: pos.height || 60,
            };
          }
        } else if (el.type === 'graph' && el.index !== undefined) {
          const pos = graphPositions?.[selectedKeyType]?.[el.index];
          if (pos) {
            bounds = {
              x: pos.dx,
              y: pos.dy,
              width: pos.width || 200,
              height: pos.height || 100,
            };
          }
        } else if (el.type === 'knob' && el.index !== undefined) {
          const pos = knobPositions?.[selectedKeyType]?.[el.index];
          if (pos) {
            bounds = {
              x: pos.dx,
              y: pos.dy,
              width: pos.width || 60,
              height: pos.height || 60,
            };
          }
        } else if (el.type === 'plugin') {
          const pluginEl = pluginElements.find((p) => p.fullId === el.id);
          if (pluginEl && pluginEl.measuredSize) {
            bounds = {
              x: pluginEl.position.x,
              y: pluginEl.position.y,
              width: pluginEl.measuredSize.width,
              height: pluginEl.measuredSize.height,
            };
          }
        }
        if (!bounds) return null;

        // 단일 선택이고 프리뷰 bounds가 있으면 프리뷰 bounds 사용 (드래그 중 파란 선도 함께 이동)
        let displayBounds = bounds;
        if (selectedElements.length === 1 && previewBounds) {
          displayBounds = previewBounds;
        }

        return (
          <div
            key={el.id}
            style={{
              position: 'absolute',
              left: displayBounds.x * zoom + panX - 2,
              top: displayBounds.y * zoom + panY - 2,
              width: displayBounds.width * zoom + 4,
              height: displayBounds.height * zoom + 4,
              border: '2px solid var(--ui-selection-border)',
              borderRadius: '4px',
              pointerEvents: 'none',
              zIndex: 20,
            }}
          />
        );
      })}
      {/* 단일 선택 시 리사이즈 핸들 표시 */}
      {selectedElements.length === 1 &&
        (() => {
          const el = selectedElements[0];
          let bounds = null;
          let elementId = null;

          if (el.type === 'key' && el.index !== undefined) {
            // 키 요소
            const pos = positions[selectedKeyType]?.[el.index];
            if (!pos) return null;

            bounds = {
              x: pos.dx,
              y: pos.dy,
              width: pos.width || 60,
              height: pos.height || 60,
            };
            elementId = `key-${el.index}`;
          } else if (el.type === 'stat' && el.index !== undefined) {
            const pos = statPositions?.[selectedKeyType]?.[el.index];
            if (!pos) return null;

            bounds = {
              x: pos.dx,
              y: pos.dy,
              width: pos.width || 60,
              height: pos.height || 60,
            };
            elementId = `stat-${el.index}`;
          } else if (el.type === 'graph' && el.index !== undefined) {
            const pos = graphPositions?.[selectedKeyType]?.[el.index];
            if (!pos) return null;

            bounds = {
              x: pos.dx,
              y: pos.dy,
              width: pos.width || 200,
              height: pos.height || 100,
            };
            elementId = `graph-${el.index}`;
          } else if (el.type === 'knob' && el.index !== undefined) {
            const pos = knobPositions?.[selectedKeyType]?.[el.index];
            if (!pos) return null;

            bounds = {
              x: pos.dx,
              y: pos.dy,
              width: pos.width || 60,
              height: pos.height || 60,
            };
            elementId = `knob-${el.index}`;
          } else if (el.type === 'plugin') {
            // 플러그인 요소 - resizable 속성 확인
            const pluginEl = pluginElements.find((p) => p.fullId === el.id);
            if (!pluginEl || !pluginEl.measuredSize) {
              return null;
            }

            // definitions에서 해당 플러그인의 resizable 설정 확인
            const definitions =
              usePluginDisplayElementStore.getState().definitions;
            const definition = pluginEl.definitionId
              ? definitions.get(pluginEl.definitionId)
              : null;

            // resizable이 true인 경우에만 리사이즈 핸들 표시
            if (!definition?.resizable) return null;

            bounds = {
              x: pluginEl.position.x,
              y: pluginEl.position.y,
              width: pluginEl.measuredSize.width,
              height: pluginEl.measuredSize.height,
            };
            elementId = el.id;
          }

          if (!bounds || !elementId) return null;

          if (hasGradientEditSession) return null;

          return (
            <ResizeHandles
              bounds={bounds}
              previewBounds={previewBounds}
              zoom={zoom}
              panX={panX}
              panY={panY}
              onResizeStart={handleResizeStart}
              onResize={handleResize}
              onResizeEnd={handleResizeComplete}
              elementId={elementId}
              getOtherElements={getOtherElements}
            />
          );
        })()}
      {/* 다중 선택 시 그룹 리사이즈 핸들 표시 */}
      {selectedElements.length > 1 && !hasGradientEditSession && (
        <GroupResizeHandles
          selectedElements={selectedElements}
          positions={positions}
          statPositions={statPositions}
          graphPositions={graphPositions}
          knobPositions={knobPositions}
          selectedKeyType={selectedKeyType}
          pluginElements={pluginElements}
          zoom={zoom}
          panX={panX}
          panY={panY}
          previewGroupBounds={previewGroupBounds}
          onGroupResizeStart={handleResizeStart}
          onGroupResize={(result) => handleGroupResize(result)}
          onGroupResizeEnd={handleGroupResizeComplete}
          getOtherElements={getOtherElements}
        />
      )}
      {/* 온캔버스 그라데이션 각도 핸들 — 피커가 그라데이션 형식일 때만 표시 */}
      <GradientAxisOverlay
        positions={positions}
        statPositions={statPositions}
        graphPositions={graphPositions}
        knobPositions={knobPositions}
        selectedElements={selectedElements}
        selectedKeyType={selectedKeyType}
        zoom={zoom}
        panX={panX}
        panY={panY}
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
              : getKeyMenuItems(contextIndex)
          }
          onSelect={async (id: string) => {
            if (contextType === 'mixed') {
              if (id === 'delete') {
                await deleteSelectedElements();
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

            if (contextType === 'stat') {
              const pos =
                useStatItemStore.getState().positions?.[selectedKeyType]?.[
                  contextIndex
                ] || null;
              const displayName = pos ? getStatTypeLabel(pos.statType) : '';

              if (id === 'delete') {
                showConfirm(
                  t('confirm.removeStat', { name: displayName }),
                  () => deleteStatAtIndex(contextIndex),
                  { confirmText: t('confirm.remove') },
                );
              } else if (id === 'duplicate') {
                beginDuplicateStat(contextIndex);
              } else if (id === 'bringToFront') {
                moveStatToFront(contextIndex);
              } else if (id === 'sendToBack') {
                moveStatToBack(contextIndex);
              }

              setIsContextOpen(false);
              setContextPosition(null);
              return;
            }

            if (contextType === 'graph') {
              const pos =
                useGraphItemStore.getState().positions?.[selectedKeyType]?.[
                  contextIndex
                ] || null;
              const displayName = pos ? getStatTypeLabel(pos.statType) : '';

              if (id === 'delete') {
                showConfirm(
                  t('confirm.removeGraph', { name: displayName }),
                  () => deleteGraphAtIndex(contextIndex),
                  { confirmText: t('confirm.remove') },
                );
              } else if (id === 'duplicate') {
                beginDuplicateGraph(contextIndex);
              } else if (id === 'bringToFront') {
                moveGraphToFront(contextIndex);
              } else if (id === 'sendToBack') {
                moveGraphToBack(contextIndex);
              }

              setIsContextOpen(false);
              setContextPosition(null);
              return;
            }

            if (contextType === 'knob') {
              if (id === 'delete') {
                showConfirm(
                  t('confirm.removeKnob', { name: 'Knob' }),
                  () => deleteKnobAtIndex(contextIndex),
                  { confirmText: t('confirm.remove') },
                );
              } else if (id === 'duplicate') {
                beginDuplicateKnob(contextIndex);
              } else if (id === 'bringToFront') {
                moveKnobToFront(contextIndex);
              } else if (id === 'sendToBack') {
                moveKnobToBack(contextIndex);
              }

              setIsContextOpen(false);
              setContextPosition(null);
              return;
            }

            // 플러그인 메뉴 처리
            const pluginItem = pluginKeyMenuItems.find(
              (item) => item.fullId === id,
            );
            if (pluginItem) {
              const positionForContext =
                positions[selectedKeyType]?.[contextIndex];
              if (!positionForContext) return;
              const context = {
                keyCode: keyMappings[selectedKeyType]?.[contextIndex] || '',
                index: contextIndex,
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

            // 기본 메뉴 처리
            if (id === 'delete') {
              const globalKey =
                keyMappings[selectedKeyType]?.[contextIndex] || '';
              const displayName =
                getKeyInfoByGlobalKey(globalKey)?.displayName || globalKey;
              showConfirm(
                t('confirm.removeKey', { name: displayName }),
                () => onKeyDelete(contextIndex),
                { confirmText: t('confirm.remove') },
              );
            } else if (id === 'duplicate') {
              const keyCode =
                keyMappings[selectedKeyType]?.[contextIndex] || '';
              const position =
                positions[selectedKeyType]?.[contextIndex] || null;
              if (position) {
                const clonedNoteColor =
                  position.noteColor &&
                  typeof position.noteColor === 'object' &&
                  position.noteColor !== null
                    ? { ...position.noteColor }
                    : position.noteColor;
                const clonedCounter: KeyCounterSettings | null =
                  position.counter
                    ? {
                        ...position.counter,
                        fill: { ...position.counter.fill },
                        stroke: { ...position.counter.stroke },
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
                const initialCursor = null;
                // 현재 실제 마우스 위치를 사용 (메뉴를 클릭한 시점의 위치)
                const currentMousePos = lastMousePosRef.current;
                const _snapped = computeSnappedCursorFromClient(
                  currentMousePos.x,
                  currentMousePos.y,
                );
                setDuplicateState({
                  elementType: 'key',
                  sourceIndex: contextIndex,
                  keyName: keyCode,
                  position: {
                    ...position,
                    noteColor: clonedNoteColor,
                    counter: clonedCounter ?? createDefaultCounterSettings(),
                  },
                });
                setDuplicateCursor(initialCursor);
              }
            } else if (id === 'counterReset') {
              const globalKey =
                keyMappings[selectedKeyType]?.[contextIndex] || '';
              const displayName =
                getKeyInfoByGlobalKey(globalKey)?.displayName || globalKey;
              showConfirm(
                t('confirm.resetKeyCounter', { name: displayName }),
                async () => {
                  try {
                    await window.api.keys.resetSingleCounter(
                      selectedKeyType,
                      globalKey,
                    );
                  } catch (error) {
                    console.error('Failed to reset key counter', error);
                  }
                },
                { confirmText: t('confirm.reset') },
              );
            } else if (id === 'bringToFront') {
              if (typeof onMoveToFront === 'function') {
                onMoveToFront(contextIndex);
              }
            } else if (id === 'bringForward') {
              if (typeof onMoveForward === 'function') {
                onMoveForward(contextIndex);
              }
            } else if (id === 'sendBackward') {
              if (typeof onMoveBackward === 'function') {
                onMoveBackward(contextIndex);
              }
            } else if (id === 'sendToBack') {
              if (typeof onMoveToBack === 'function') {
                onMoveToBack(contextIndex);
              }
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
            if (id === 'add' && gridAddLocalPos) {
              addKeyAtPosition(gridAddLocalPos.dx, gridAddLocalPos.dy);
            } else if (id === 'addStat' && gridAddLocalPos) {
              addStatAtPosition(gridAddLocalPos.dx, gridAddLocalPos.dy);
            } else if (id === 'addGraph' && gridAddLocalPos) {
              addGraphAtPosition(gridAddLocalPos.dx, gridAddLocalPos.dy);
            } else if (id === 'addKnob' && gridAddLocalPos) {
              addKnobAtPosition(gridAddLocalPos.dx, gridAddLocalPos.dy);
            } else if (id === 'tabCss') {
              setIsTabCssModalOpen(true);
            } else if (id === 'tabNote') {
              setIsNoteSettingOpen(false);
              setIsTabNoteModalOpen(true);
            }
            setIsGridContextOpen(false);
            setGridContextClientPos(null);
            setGridAddLocalPos(null);
          }}
        />
      </div>
      <GridKeySettingModal
        selectedKey={selectedKey}
        setSelectedKey={setSelectedKey}
        currentKeyPosition={
          selectedKey
            ? positions[selectedKeyType]?.[selectedKey.index]
            : undefined
        }
        onKeyUpdate={onKeyUpdate}
        onKeyPreview={onKeyPreview}
        onNoteColorPreview={onNoteColorPreview}
        onCounterPreview={onCounterPreview}
        shouldSkipModalAnimation={shouldSkipModalAnimation}
        onModalAnimationConsumed={onModalAnimationConsumed}
      />
      {/* 미니맵 */}
      {minimapEnabled && (
        <GridMinimap
          positions={positions[selectedKeyType] || []}
          statPositions={statPositions?.[selectedKeyType] || []}
          graphPositions={graphPositions?.[selectedKeyType] || []}
          knobPositions={knobPositions?.[selectedKeyType] || []}
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
      {/* <ZoomIndicator zoom={zoom} /> */}
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
