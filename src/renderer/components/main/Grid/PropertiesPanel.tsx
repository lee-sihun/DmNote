import React, { useEffect, useState, useRef } from 'react';
import { useTranslation } from '@contexts/useTranslation';
import { usePanelHost } from '@contexts/PanelHostContext';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { useSettingsStore } from '@stores/useSettingsStore';
import { usePropertiesPanelStore } from '@stores/grid/usePropertiesPanelStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import {
  getDefaultSettings,
  omitLayoutSettingValues,
  type SettingsNormalizationErrorKind,
} from '@plugins/runtime/settingsSections';
import { updatePluginElement } from '@plugins/runtime/displayElement/pluginElementActions';
import type { KeyPosition } from '@src/types/key/keys';
import type { GraphItemPosition } from '@src/types/key/graphItems';
import type { KnobItemPosition } from '@src/types/key/knobs';
import type { BatchElementPropertyUpdate } from './PropertiesPanel/types';
import type {
  EditorElementTypeV1,
  EditorCounterFillPropertyPatchV1,
} from '@src/types/editor';
import { normalizeCounterSettings } from '@src/types/key/keys';
import { useLenis } from '@hooks/useLenis';
import { usePluginGeometryGesture } from '@hooks/Grid/usePluginGeometryGesture';
import { editGestureController } from '@src/renderer/editor/runtime/editGestureController';
import {
  commitBatchGeometryByIds,
  patchElementLayerNameById,
  renameLayerGroupById,
  patchFontFamilyByTargets,
  patchFontStyleByTargets,
  patchGraphColorsByIds,
  patchGraphPropertiesByIds,
  patchGraphTypesByIds,
  patchKnobPropertiesByIds,
  patchNotePropertiesByIds,
  patchUseInlineStylesByTargets,
} from '@src/renderer/editor/runtime/elementOps';
import type { BatchGeometryDescriptor } from '@src/renderer/editor/runtime/elementOps';
import { resolveElementById } from '@src/renderer/editor/model/elementIdMap';
import { isNativeElementId } from '@src/renderer/editor/model/elementId';
import { computeBatchGeometryPlan } from '@src/renderer/editor/runtime/batchGeometryPlan';
import { commitMixedBatchGeometry } from '@src/renderer/editor/runtime/mixedBatchGeometry';

// 분리된 컴포넌트들 및 훅
import {
  TABS,
  LayerPanel,
  PluginSelectionPanel,
  SingleGraphPanel,
  SingleKnobPanel,
  SingleKeyStatPanel,
  BatchKeyLikePanel,
  BatchGraphOnlyPanel,
  BatchKnobOnlyPanel,
  BatchPluginOnlyPanel,
  PluginSettingsPanelView,
  useBatchHandlers,
  usePanelScroll,
} from './PropertiesPanel/index';
import {
  SIDE_PANEL_FRAME_CLASS,
  WINDOW_PANEL_FRAME_CLASS,
} from './PropertiesPanel/panelChrome';
import { resolveSelectionPanelRoute } from './PropertiesPanel/selectionPanelRoute';
import { PanelNavProvider } from './PropertiesPanel/PanelNavContext';
import PanelHeaderActions from './PropertiesPanel/PanelHeaderActions';
import PanelToggleButton from './PropertiesPanel/PanelToggleButton';
import type { NoteColor } from '@src/types/key/keys';
import { EditSessionScope } from '@src/renderer/contexts/EditSessionScope';
import { previewSingleGraphColor } from './PropertiesPanel/previewPatchForwarders';
import { reportElementOpSkipped } from '@src/renderer/editor/runtime/elementIntent';
import PluginSettingsForm from './PropertiesPanel/PluginSettingsForm';
import { usePropertiesPanelSelection } from './PropertiesPanel/usePropertiesPanelSelection';
import { usePanelNavigation } from './PropertiesPanel/usePanelNavigation';
import { createBatchSelectionModel } from './PropertiesPanel/batchSelectionModel';
import { singleSelectionHandlers } from './PropertiesPanel/singleSelectionHandlers';
import {
  getFontFamilyPatch,
  getFontStylePatch,
  getGraphRuntimePropertyPatch,
  getKnobRuntimePropertyPatch,
  getNotePropertyPatch,
  getStatTypeLabel,
  getUseInlineStylesPatch,
  shouldNormalizePropertyTabToStyle,
} from './PropertiesPanel/propertyPanelAdapters';

// ============================================================================
// 메인 컴포넌트 Props
// ============================================================================

interface PropertiesPanelProps {
  onKeyMappingChange?: (index: number, newKey: string) => void;
  // 분리 창 전환 액션 - 메인은 detach, 분리 창은 reattach
  detachAction?: 'detach' | 'reattach';
  onDetachAction?: () => void;
  // 분리 창에서는 인셋 채움 프레임 사용
  frameVariant?: 'inline' | 'window';
}

// ============================================================================
// 메인 컴포넌트
// ============================================================================

const PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  detachAction,
  onDetachAction,
  frameVariant = 'inline',
  onKeyMappingChange,
}) => {
  const { t, i18n } = useTranslation();
  // 패널이 분리 창에 있으면 키·마우스 이벤트는 그 창의 document로 온다
  const { document: hostDocument } = usePanelHost();
  const {
    selectedElements,
    selectedKeyType,
    positions,
    canonicalPositions,
    keyMappings,
    statItemPositions,
    graphItemPositions,
    knobItemPositions,
    selectedKeyElements,
    selectedStatElements,
    selectedGraphElements,
    selectedKnobElements,
    selectedKeyLikeElements,
    selectedBatchStyleElements,
    selectedPluginElements,
    selectedPluginElement,
    stableBatchGeometryTargets,
    stablePluginGeometryElements,
    stablePluginGeometryTargets,
    selectedPluginDefinition,
    hasSinglePluginSelection,
    showModalHint,
    showSettings,
    isPluginResizable,
    pluginDisplaySize,
    singleKeyIndex,
    singleKeyPosition,
    singleCanonicalKeyPosition,
    singleKeySlot,
    singleKeyCode,
    singleKeyInfo,
    singleStatIndex,
    singleStatPosition,
    singleGraphIndex,
    singleGraphPosition,
    singleKnobPosition,
    selectedGroupInfo,
  } = usePropertiesPanelSelection();
  const { useCustomCSS } = useSettingsStore();
  const pluginSettingsPanel = usePropertiesPanelStore(
    (state) => state.pluginSettingsPanel,
  );
  const closePluginSettingsPanel = usePropertiesPanelStore(
    (state) => state.closePluginSettingsPanel,
  );
  const isPanelVisibleStore = usePropertiesPanelStore(
    (state) => state.isCanvasPanelOpen,
  );
  // 분리 창은 창 자체가 패널 - 가시성 개념이 없어 항상 열림으로 취급해야
  // 선택 도착·해제가 모드를 property로 강제하거나 내용을 숨기지 않음
  const isPanelVisible = frameVariant === 'window' || isPanelVisibleStore;
  const setIsPanelVisible = usePropertiesPanelStore(
    (state) => state.setCanvasPanelOpen,
  );
  const canvasPanelToggleSignal = usePropertiesPanelStore(
    (state) => state.canvasPanelToggleSignal,
  );
  const locale = i18n.language;

  // 로컬 상태 (실시간 편집용)
  const [localState, setLocalState] = useState<
    Partial<KeyPosition> & { dx?: number; dy?: number }
  >({});
  const pluginVisibilityErrorsRef = useRef(new Set<string>());
  const [pluginPanelSettings, setPluginPanelSettings] = useState<
    Record<string, unknown>
  >({});
  const [isPluginSettingsSaving, setIsPluginSettingsSaving] = useState(false);
  const pluginSettingsSavingRef = useRef(false);

  // 레이어 이름 변경 상태
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameCancelledRef = useRef(false);
  const renameRequestSignal = usePropertiesPanelStore(
    (state) => state.renameRequestSignal,
  );

  // 이미지 픽커 상태
  const [showImagePicker, setShowImagePicker] = useState(false);
  const imageButtonRef = useRef<HTMLButtonElement>(null);
  const [showGraphImagePicker, setShowGraphImagePicker] = useState(false);
  const graphImageButtonRef = useRef<HTMLButtonElement>(null);
  const [graphClassNameDraft, setGraphClassNameDraft] = useState('');

  // 다중 선택용 이미지 픽커 상태
  const [showBatchImagePicker, setShowBatchImagePicker] = useState(false);
  const batchImageButtonRef = useRef<HTMLButtonElement>(null);

  // 일괄 편집용 컬러 버튼 refs
  const batchNoteColorButtonRef = useRef<HTMLButtonElement>(null);
  const batchGlowColorButtonRef = useRef<HTMLButtonElement>(null);
  const batchBorderColorButtonRef = useRef<HTMLButtonElement>(null);
  const batchCounterFillButtonRef = useRef<HTMLButtonElement>(null);

  // 패널 ref (컬러픽커/이미지픽커 위치 기준)
  const [panelElement, setPanelElement] = useState<HTMLDivElement | null>(null);

  // 패널 모드 (layer: 레이어 패널, property: 속성 패널)
  // 설정 왕복으로 리마운트돼도 열림 상태와 함께 보존되도록 store에 유지
  const panelMode = usePropertiesPanelStore((state) => state.canvasPanelMode);
  const setPanelMode = usePropertiesPanelStore(
    (state) => state.setCanvasPanelMode,
  );

  // panelMode를 ref로도 유지 (useEffect에서 최신 값 참조용)
  const panelModeRef = useRef(panelMode);
  panelModeRef.current = panelMode;

  // 이전 선택 상태 추적 (선택 해제 감지용)
  const prevHasSelectionRef = useRef(false);

  // 레이어 패널 내부에서 선택이 발생했는지 추적 (모드 전환 방지용)
  const selectionFromLayerPanelRef = useRef(false);

  // 이전 키 타입 추적 (탭 전환 감지용)
  const prevKeyTypeRef = useRef(selectedKeyType);

  // 탭 전환으로 인한 선택 해제인지 추적
  const keyTypeChangedRef = useRef(false);

  // 사용자가 명시적으로 패널을 닫았는지 추적
  const manuallyClosedRef = useRef(false);

  // selectedKeyType 변경 감지 (clearSelection보다 먼저 플래그 설정)
  useEffect(() => {
    if (prevKeyTypeRef.current !== selectedKeyType) {
      keyTypeChangedRef.current = true;
      prevKeyTypeRef.current = selectedKeyType;
    }
  }, [selectedKeyType]);

  const activeTab = usePropertiesPanelStore(
    (state) => state.propertyPanelActiveTab,
  );
  const setActiveTab = usePropertiesPanelStore(
    (state) => state.setPropertyPanelActiveTab,
  );

  const handlePluginSettingsPanelCancelImpl = useRef<() => void>(() => {});
  const panelScopeKey = [
    pluginSettingsPanel ? 'plugin-settings' : 'grid',
    selectedKeyElements.length,
    selectedElements.length,
    selectedPluginElements.length,
    selectedGraphElements.length,
    selectedKnobElements.length,
  ].join('|');
  const {
    activePageKey,
    renderPageKey,
    pageHost,
    setPageHost,
    openPage,
    closePage,
  } = usePanelNavigation({
    hostDocument,
    activeTab,
    panelMode,
    isPanelVisible,
    selectedKeyType,
    panelScopeKey,
    hasPluginSettingsPanel: !!pluginSettingsPanel,
    pluginSettingsCancelRef: handlePluginSettingsPanelCancelImpl,
  });
  // 이전 렌더의 effect가 최신 탭을 덮지 않도록 커밋 직전 재확인
  useEffect(() => {
    const latestTab = usePropertiesPanelStore.getState().propertyPanelActiveTab;
    const latestSelection = useGridSelectionStore.getState().selectedElements;
    if (shouldNormalizePropertyTabToStyle(latestSelection, latestTab)) {
      setActiveTab(TABS.STYLE);
    }
  }, [activeTab, selectedElements, setActiveTab]);

  // 레이어 이름 변경: 현재 선택된 요소의 layerName 가져오기
  const getCurrentLayerName = (): string => {
    if (selectedGroupInfo) return selectedGroupInfo.name || '';
    if (singleKeyPosition) return singleKeyPosition.layerName || '';
    if (singleStatPosition) return singleStatPosition.layerName || '';
    if (singleGraphPosition) return singleGraphPosition.layerName || '';
    if (singleKnobPosition) return singleKnobPosition.layerName || '';
    return '';
  };

  // 레이어 이름 변경: 현재 선택된 요소의 기본 표시 이름 가져오기
  const getCurrentDefaultTitle = (): string => {
    if (selectedGroupInfo) return selectedGroupInfo.name;
    if (singleKeyPosition) {
      return singleKeyInfo?.displayName || singleKeyCode || 'Key';
    }
    if (singleStatPosition) {
      return getStatTypeLabel(singleStatPosition.statType ?? null);
    }
    if (singleGraphPosition) {
      return `${getStatTypeLabel(singleGraphPosition.statType ?? null)} Graph`;
    }
    if (singleKnobPosition) return 'Knob';
    return '';
  };

  const handleGroupRenameCommit = async (groupId: string, value: string) => {
    const trimmed = value.trim();
    if (trimmed === '') return;

    const currentGroups = useLayerGroupStore.getState().layerGroups;
    const currentModeGroups = currentGroups[selectedKeyType] || [];
    const currentGroup = currentModeGroups.find(
      (group) => group.id === groupId,
    );
    if (!currentGroup || currentGroup.name === trimmed) return;

    try {
      await renameLayerGroupById(selectedKeyType, groupId, trimmed);
    } catch (error) {
      console.error('Failed to rename group', error);
    }
  };

  // 레이어 이름 변경 시작
  const handleRenameStartImpl = useRef<() => void>(() => {});
  handleRenameStartImpl.current = () => {
    const current = getCurrentLayerName();
    setRenameValue(current || getCurrentDefaultTitle());
    setIsRenaming(true);
    requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
  };
  const handleRenameStart = () => {
    handleRenameStartImpl.current();
  };

  // 레이어 이름 변경 커밋
  const handleRenameCommit = async (value: string) => {
    setIsRenaming(false);

    if (selectedGroupInfo) {
      await handleGroupRenameCommit(selectedGroupInfo.id, value);
      return;
    }

    const trimmed = value.trim();
    const defaultTitle = getCurrentDefaultTitle();
    const newLayerName =
      trimmed === defaultTitle || trimmed === '' ? null : trimmed;

    const selectedElement =
      selectedElements.length === 1 ? selectedElements[0] : null;
    const stableTarget =
      selectedElement && selectedElement.type !== 'plugin'
        ? { elementType: selectedElement.type, id: selectedElement.id }
        : null;
    if (stableTarget && isNativeElementId(stableTarget.id)) {
      const target = {
        ...stableTarget,
        patch: { property: 'layerName', value: newLayerName },
      } as const;
      try {
        await patchElementLayerNameById(
          target.elementType,
          target.id,
          target.patch.value,
        );
      } catch (error) {
        console.error('Failed to rename layer', error);
      }
    }
  };

  // 레이어 이름 변경 취소
  const handleRenameCancel = () => {
    renameCancelledRef.current = true;
    setIsRenaming(false);
  };

  // 캔버스 컨텍스트 메뉴에서 rename 요청 시 트리거
  const prevRenameSignalRef = useRef(renameRequestSignal);
  useEffect(() => {
    if (renameRequestSignal !== prevRenameSignalRef.current) {
      prevRenameSignalRef.current = renameRequestSignal;
      if (
        selectedGroupInfo ||
        singleKeyPosition ||
        singleStatPosition ||
        singleGraphPosition ||
        singleKnobPosition
      ) {
        setPanelMode('property');
        handleRenameStart();
      }
    }
  }, [
    renameRequestSignal,
    selectedGroupInfo,
    singleKeyPosition,
    singleStatPosition,
    singleGraphPosition,
    singleKnobPosition,
    setPanelMode,
  ]);

  // 선택이 변경되면 rename 모드 해제
  useEffect(() => {
    setIsRenaming(false);
  }, [selectedElements]);

  // 스크롤 훅 사용
  const { batchScrollRefFor, singleScrollRefFor } = usePanelScroll();

  // 플러그인 패널 스크롤
  const { scrollContainerRef: setPluginScrollRef } = useLenis();

  // 배치 편집용 로컬 ColorPicker 상태
  type BatchPickerTarget =
    | 'noteColor'
    | 'glowColor'
    | 'borderColor'
    | 'fill'
    | null;
  const [batchPickerFor, setBatchPickerFor] = useState<BatchPickerTarget>(null);
  const [batchCounterColorState, setBatchCounterColorState] = useState<
    'idle' | 'active'
  >('idle');
  const effectiveBatchCounterColorState =
    selectedKeyElements.length > 0 ? batchCounterColorState : 'idle';

  useEffect(() => {
    if (selectedKeyElements.length === 0) {
      setBatchCounterColorState('idle');
      setBatchPickerFor((current) => (current === 'fill' ? null : current));
    }
  }, [selectedKeyElements.length]);

  // 노트 표면(note/glow/border) 로컬 상태는 useBatchNotePaint가 소유
  const [batchLocalColors, setBatchLocalColors] = useState<{
    fillIdle: string;
    fillActive: string;
  }>({
    fillIdle: '#FFFFFF',
    fillActive: '#FFFFFF',
  });

  // 선택이 변경되면 로컬 상태 초기화
  useEffect(() => {
    const targetPosition = singleKeyPosition || singleStatPosition;
    if (targetPosition) {
      setLocalState({
        dx: targetPosition.dx,
        dy: targetPosition.dy,
        width: targetPosition.width || 60,
        height: targetPosition.height || 60,
      });
    } else {
      setLocalState({});
    }
  }, [singleKeyPosition, singleStatPosition]);

  useEffect(() => {
    setGraphClassNameDraft(singleGraphPosition?.className || '');
  }, [selectedKeyType, singleGraphIndex, singleGraphPosition?.className]);

  useEffect(() => {
    if (pluginSettingsPanel) {
      setPluginPanelSettings(pluginSettingsPanel.settings || {});
      setIsPluginSettingsSaving(false);
      pluginSettingsSavingRef.current = false;
    }
  }, [pluginSettingsPanel]);

  // 선택된 키가 변경될 때 패널 열기/닫기
  useEffect(() => {
    const hasSelection =
      selectedKeyElements.length > 0 || selectedElements.length > 0;
    const hadSelection = prevHasSelectionRef.current;

    if (pluginSettingsPanel) {
      prevHasSelectionRef.current = hasSelection;
      return;
    }

    if (hasSelection) {
      // 열린 패널의 페이지는 sticky — 레이어 목록 표시 중 캔버스 클릭은 선택만 바꾸고
      // 편집(property) 진입은 더블클릭·목록 더블클릭·헤더 토글만 수행한다 (포토샵식)
      if (!hadSelection) {
        manuallyClosedRef.current = false;
        if (!isPanelVisible) {
          setPanelMode('property');
          setIsPanelVisible(true);
        }
      } else if (!isPanelVisible && !manuallyClosedRef.current) {
        setPanelMode('property');
        setIsPanelVisible(true);
      }
    } else if (hadSelection) {
      if (keyTypeChangedRef.current && isPanelVisible) {
        setPanelMode('layer');
      } else if (
        isPanelVisible &&
        (selectionFromLayerPanelRef.current || panelModeRef.current === 'layer')
      ) {
        setPanelMode('layer');
      } else if (!manuallyClosedRef.current) {
        setIsPanelVisible(false);
      }
    }

    prevHasSelectionRef.current = hasSelection;
    selectionFromLayerPanelRef.current = false;
    keyTypeChangedRef.current = false;

    setShowImagePicker(false);
    setShowGraphImagePicker(false);
    setShowBatchImagePicker(false);
    // 배치 색상 draft는 피커를 열 때 첫 요소에서 한 번만 떠 온다.
    // 열린 채로 선택이 바뀌면 옛 대상 색이 남아 다음 드래그가 그 값을 새 선택에 쓴다
    setBatchPickerFor(null);
    closePage();
  }, [
    singleKeyIndex,
    selectedKeyElements.length,
    selectedElements,
    isPanelVisible,
    pluginSettingsPanel,
    setIsPanelVisible,
    setPanelMode,
    closePage,
  ]);

  // 빈 선택 폴백으로 레이어 목록이 표시되는 동안 내부 모드도 layer로 정규화 —
  // property로 남아 있으면 다음 캔버스 클릭이 목록을 건너뛰고 편집으로 점프함
  // (플러그인 설정 패널 종료·설정 왕복 리마운트 경로 포함)
  useEffect(() => {
    if (
      isPanelVisible &&
      !pluginSettingsPanel &&
      panelMode === 'property' &&
      selectedKeyElements.length === 0 &&
      selectedElements.length === 0
    ) {
      setPanelMode('layer');
    }
  }, [
    isPanelVisible,
    pluginSettingsPanel,
    panelMode,
    selectedKeyElements.length,
    selectedElements,
    setPanelMode,
  ]);

  // 다중 선택 시 패널 자동 열기 - 개수는 native+plugin 합산
  useEffect(() => {
    if (
      selectedBatchStyleElements.length + selectedPluginElements.length > 1 &&
      !isPanelVisible &&
      !manuallyClosedRef.current
    ) {
      setPanelMode('property');
      setIsPanelVisible(true);
    }
  }, [
    selectedBatchStyleElements.length,
    selectedPluginElements.length,
    isPanelVisible,
    setIsPanelVisible,
    setPanelMode,
  ]);

  useEffect(() => {
    if (pluginSettingsPanel) {
      manuallyClosedRef.current = false;
      setPanelMode('property');
      setIsPanelVisible(true);
    }
  }, [pluginSettingsPanel, setIsPanelVisible, setPanelMode]);

  // 레이어 뷰가 표시된 상태(선택 없음)에서 그리드 빈 공간 클릭 시 패널 닫기
  // panelMode가 property로 남아 있어도 선택이 없으면 레이어 뷰가 표시되므로 동일하게 닫음.
  // 분리 창일 때는 접힘이 없다 - 여기서 스토어를 닫으면 도킹 뒤 패널이 접힌 채 돌아온다
  useEffect(() => {
    const hasSelection =
      selectedKeyElements.length > 0 || selectedElements.length > 0;
    if (frameVariant === 'window' || !isPanelVisible || hasSelection) {
      return undefined;
    }

    const handleGridClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      const gridContainer = target.closest('[data-grid-container]');
      if (!gridContainer) {
        return;
      }

      if (
        target.closest('[class*="properties-panel"]') ||
        target.closest('[class*="PropertiesPanel"]') ||
        target.closest('.absolute.right-0.top-0.bottom-0')
      ) {
        return;
      }

      if (
        target.closest('[data-key-element]') ||
        target.closest('[data-plugin-element]')
      ) {
        return;
      }

      setIsPanelVisible(false);
    };

    document.addEventListener('mousedown', handleGridClick);
    return () => {
      document.removeEventListener('mousedown', handleGridClick);
    };
  }, [
    frameVariant,
    isPanelVisible,
    selectedKeyElements.length,
    selectedKeyLikeElements.length,
    selectedElements.length,
    setIsPanelVisible,
  ]);

  // ============================================================================
  // 핸들러
  // ============================================================================

  const handleTogglePanelImpl = useRef<() => void>(() => {});
  handleTogglePanelImpl.current = () => {
    const willOpen = !isPanelVisible;

    if (willOpen) {
      manuallyClosedRef.current = false;
      setIsPanelVisible(true);
      const hasSelection = selectedElements.length > 0;
      if (!hasSelection) {
        setPanelMode('layer');
      }
    } else {
      manuallyClosedRef.current = true;
      setIsPanelVisible(false);
      setShowImagePicker(false);
      setShowGraphImagePicker(false);
      setShowBatchImagePicker(false);
    }
  };
  const handleTogglePanel = () => {
    handleTogglePanelImpl.current();
  };

  const handleToggleMode = () => {
    setPanelMode(panelMode === 'layer' ? 'property' : 'layer');
  };

  // 분리 창은 접힘 없음 - 창 자체가 패널이므로 항상 표시
  const showFrame =
    frameVariant === 'window' || isPanelVisible || !!pluginSettingsPanel;

  const pluginDefaultSettings = getDefaultSettings(
    selectedPluginDefinition?.settings,
  );

  const resolvedPluginSettings = {
    ...pluginDefaultSettings,
    ...omitLayoutSettingValues(
      selectedPluginDefinition?.settings,
      selectedPluginElement?.settings || {},
    ),
  };

  // 위치·크기 숫자 입력은 캔버스 드래그와 같은 플러그인 편집 세션을 쓴다 -
  // 값의 원본이 프론트 스토어라 preview_broker 대신 세션 경계에서 한 번 저장
  const pluginGeometryGesture = usePluginGeometryGesture(
    selectedPluginElement
      ? {
          fullId: selectedPluginElement.fullId,
          pluginId: selectedPluginElement.pluginId,
        }
      : null,
  );

  const handlePluginSettingChange = (key: string, value: unknown) => {
    if (!selectedPluginElement) return;
    updatePluginElement(selectedPluginElement.fullId, {
      settings: {
        [key]: value,
      },
    });
  };

  const handlePluginSettingsPanelChange = (key: string, value: unknown) => {
    if (!pluginSettingsPanel) return;
    setPluginPanelSettings((prev) => {
      const next = { ...prev, [key]: value };
      pluginSettingsPanel.onChange(next);
      return next;
    });
  };

  const handlePluginSettingsPanelConfirm = async () => {
    if (!pluginSettingsPanel || pluginSettingsSavingRef.current) return;
    pluginSettingsSavingRef.current = true;
    setIsPluginSettingsSaving(true);
    try {
      await pluginSettingsPanel.onConfirm(
        pluginPanelSettings,
        pluginSettingsPanel.originalSettings,
      );
      pluginSettingsPanel.resolve(true);
    } catch (error) {
      console.error('[Plugin Settings] Failed to apply settings:', error);
      pluginSettingsPanel.resolve(false);
    } finally {
      pluginSettingsSavingRef.current = false;
      setIsPluginSettingsSaving(false);
      closePluginSettingsPanel();
    }
  };

  handlePluginSettingsPanelCancelImpl.current = () => {
    if (!pluginSettingsPanel || pluginSettingsSavingRef.current) return;
    try {
      pluginSettingsPanel.onCancel(pluginSettingsPanel.originalSettings);
    } catch (error) {
      console.error('[Plugin Settings] Failed to cancel settings:', error);
    } finally {
      pluginSettingsPanel.resolve(false);
      closePluginSettingsPanel();
    }
  };
  const handlePluginSettingsPanelCancel = () => {
    handlePluginSettingsPanelCancelImpl.current();
  };

  // 외부(단축키 등)에서 보낸 사이드 패널 토글 요청 처리
  const prevToggleSignalRef = useRef<number>(canvasPanelToggleSignal);
  useEffect(() => {
    if (prevToggleSignalRef.current === canvasPanelToggleSignal) return;
    prevToggleSignalRef.current = canvasPanelToggleSignal;

    if (pluginSettingsPanel) {
      handlePluginSettingsPanelCancel();
      return;
    }
    handleTogglePanel();
  });

  const {
    stableGeometryHandler,
    stableGeometryPreviewHandler,
    stableElementPropertyCommitHandler,
    stableInactiveImageHandler,
    stableActiveImageHandler,
    stableIdleTransparentHandler,
    stableActiveTransparentHandler,
    stableIdleImageFitHandler,
    stableActiveImageFitHandler,
    stableSoundPathHandler,
    stableSoundEnabledHandler,
    stableSoundVolumeHandler,
    stableStylePropertyPreviewHandler,
    stableStylePropertyCommitHandler,
    stablePaintCommitHandler,
    stablePaintPreviewHandler,
    stableShadowCommitHandler,
    stableNotePaintCommitHandler,
    stableNotePaintPreviewHandler,
    stableCounterAnimationPresetHandler,
    stableCounterEnabledHandler,
    stableCounterAnimationEnabledHandler,
    stableCounterLayoutHandler,
    stableCounterTypographyHandler,
    stableCounterFillHandler,
  } = singleSelectionHandlers;
  const {
    getSelectedKeysData,
    getSelectedGraphsData,
    getSelectedKnobsData,
    getSelectedBatchStyleData,
    getSelectedKeyOnlyPositions,
    getMixedValue,
    getMixedValueCanonical,
    getMixedValueGraphs,
    getMixedValueGraphsAsKey,
    getMixedValueKnobs,
    getMixedValueKnobsAsKey,
    getMixedValueBatch,
    getMixedValueActiveCapable,
    getMixedValueKeysOnly,
  } = createBatchSelectionModel({
    selectedKeyType,
    positions,
    canonicalPositions,
    keyMappings,
    statItemPositions,
    graphItemPositions,
    knobItemPositions,
    selectedKeyElements,
    selectedKeyLikeElements,
    selectedGraphElements,
    selectedKnobElements,
    selectedBatchStyleElements,
  });
  // 다중 선택 일괄 편집 핸들러 (훅 사용)
  // ============================================================================

  const {
    handleBatchAlign,
    handleBatchDistribute,
    handleBatchSpacing,
    handleBatchSpacingPreview,
    handleBatchSpacingCommit,
    getBatchSpacingValue,
    handleBatchResize,
    handleBatchResizePreview,
  } = useBatchHandlers({
    selectedKeyLikeElements: selectedBatchStyleElements as {
      type: 'key' | 'stat' | 'graph' | 'knob';
      id: string;
      index?: number;
    }[],
    keyPositions: positions,
    statPositions: statItemPositions,
    graphPositions: graphItemPositions,
    selectedKeyType,
    knobPositions: knobItemPositions,
    pluginLayoutElements: stablePluginGeometryElements,
    onStableGeometryPreview: (operation) => {
      if (!stableBatchGeometryTargets) return;
      if (stablePluginGeometryElements === null) return;
      const targetsByKey = new Map<
        string,
        {
          type: EditorElementTypeV1;
          position: KeyPosition;
        }
      >();
      for (const target of stableBatchGeometryTargets) {
        const locator = resolveElementById(target.type, target.id);
        if (!locator || locator.mode !== selectedKeyType) return;
        const record =
          target.type === 'key'
            ? positions
            : target.type === 'stat'
            ? statItemPositions
            : target.type === 'graph'
            ? graphItemPositions
            : knobItemPositions;
        const position = record[selectedKeyType]?.[locator.index];
        if (!position || position.id !== target.id) return;
        targetsByKey.set(`${target.type}:${target.id}`, {
          type: target.type,
          position,
        });
      }
      // 커밋과 같은 기준선을 쓰도록 plan 입력에는 plugin bounds를 합치되,
      // preview 반영은 native 4 domain 전용 - 플러그인은 dial 중 정지,
      // 커밋 시 착지 (v1). resize는 native 전용이라 plugin 미합류
      const pluginPlanInputs =
        operation.kind === 'resize' ? [] : stablePluginGeometryElements;
      const plan = computeBatchGeometryPlan(
        [
          ...[...targetsByKey].map(([key, { position }]) => ({
            key,
            x: position.dx,
            y: position.dy,
            width: position.width,
            height: position.height,
          })),
          ...pluginPlanInputs.map((element) => ({
            key: `plugin:${element.fullId}`,
            x: element.x,
            y: element.y,
            width: element.width,
            height: element.height,
          })),
        ],
        operation,
      );
      if (!plan) return;
      const byType = new Map<
        EditorElementTypeV1,
        Array<{ id: string; patch: Record<string, unknown> }>
      >();
      for (const update of plan.updates) {
        if (update.key.startsWith('plugin:')) continue;
        const target = targetsByKey.get(update.key);
        if (!target) return;
        const entries = byType.get(target.type) ?? [];
        entries.push({
          id: target.position.id,
          patch: update.patch,
        });
        byType.set(target.type, entries);
      }
      for (const [type, entries] of byType) {
        editGestureController.preview(selectedKeyType, entries, {
          domain:
            type === 'key'
              ? 'keyPosition'
              : type === 'stat'
              ? 'statPosition'
              : type === 'graph'
              ? 'graphPosition'
              : 'knobPosition',
        });
      }
    },
    onStableGeometryCommit: (operation, options) => {
      if (!stableBatchGeometryTargets) return;
      // plugin 대상 미해결 상태의 커밋은 fail-closed
      if (stablePluginGeometryTargets === null) return;
      const descriptor: BatchGeometryDescriptor = {
        mode: selectedKeyType,
        targets: stableBatchGeometryTargets,
        operation,
      };
      const gestureId =
        options?.gestureId ??
        (operation.kind === 'resize'
          ? editGestureController.activeGestureId() ?? undefined
          : undefined);
      // 크기 일괄은 native 전용 - 플러그인 크기는 content-driven
      const pluginTargets =
        operation.kind === 'resize' ? [] : stablePluginGeometryTargets;
      const commit =
        pluginTargets.length > 0
          ? commitMixedBatchGeometry(descriptor, pluginTargets, {
              ...(gestureId ? { gestureId } : {}),
            })
          : commitBatchGeometryByIds(descriptor, {
              ...(gestureId ? { gestureId } : {}),
            });
      if (operation.kind === 'resize' || operation.kind === 'spacing') {
        editGestureController.settleCommit(commit);
      }
      void commit.catch((error) => {
        console.error('Failed to commit batch geometry', error);
      });
    },
  });

  // 단일 키 업데이트 객체를 받는다. 아래 get*Patch 헬퍼가 태그 유니온으로 바꿔 wire에 올린다
  const handleBatchElementPropertyCommit = (
    patch: BatchElementPropertyUpdate,
    options?: { gestureId?: string },
  ) => {
    const fontStylePatch = getFontStylePatch(patch);
    const fontFamilyPatch = getFontFamilyPatch(patch);
    const useInlineStyles = getUseInlineStylesPatch(patch);
    if (!fontStylePatch && !fontFamilyPatch && useInlineStyles === null) return;
    const targets = selectedBatchStyleElements.map((element) => ({
      elementType: element.type as EditorElementTypeV1,
      id: element.id,
    }));
    if (
      targets.length === 0 ||
      targets.some((target) => !isNativeElementId(target.id))
    )
      return;
    const gestureId = options?.gestureId;
    const commit =
      fontStylePatch !== null
        ? gestureId
          ? patchFontStyleByTargets(targets, fontStylePatch, { gestureId })
          : patchFontStyleByTargets(targets, fontStylePatch)
        : fontFamilyPatch !== null
        ? gestureId
          ? patchFontFamilyByTargets(targets, fontFamilyPatch, { gestureId })
          : patchFontFamilyByTargets(targets, fontFamilyPatch)
        : patchUseInlineStylesByTargets(targets, useInlineStyles!);
    void commit.catch((error) => {
      console.error('Failed to batch update element style property', error);
    });
  };

  const handleBatchNoteElementPropertyCommit = (
    patch: BatchElementPropertyUpdate,
  ) => {
    const notePatch = getNotePropertyPatch(patch);
    if (!notePatch) return;
    const ids = selectedKeyElements.map((element) => element.id);
    if (ids.length === 0 || ids.some((id) => !isNativeElementId(id))) return;
    const commit = patchNotePropertiesByIds(ids, notePatch);
    void commit.catch((error) => {
      console.error('Failed to batch update note property', error);
    });
  };

  const handleGraphBatchSharedSetting = (
    updates: Partial<GraphItemPosition>,
  ) => {
    const updateKeys = Object.keys(updates);
    const graphType = updates.graphType;
    const graphColor = updates.graphColor;
    const runtimePatch = getGraphRuntimePropertyPatch(updates);
    const stableGraphIds = selectedGraphElements.map((element) => element.id);
    if (
      updateKeys.length === 1 &&
      updateKeys[0] === 'graphType' &&
      (graphType === 'line' || graphType === 'bar') &&
      stableGraphIds.length > 0 &&
      stableGraphIds.every((id) => id.length > 0 && isNativeElementId(id))
    ) {
      const commit = patchGraphTypesByIds(stableGraphIds, graphType);
      void commit.catch((error) => {
        console.error('Failed to batch update graph type', error);
      });
      return;
    }
    if (
      runtimePatch &&
      stableGraphIds.length > 0 &&
      stableGraphIds.every((id) => id.length > 0 && isNativeElementId(id))
    ) {
      const commit = patchGraphPropertiesByIds(stableGraphIds, runtimePatch);
      void commit.catch((error) => {
        console.error('Failed to batch update graph property', error);
      });
      return;
    }
    if (
      updateKeys.length === 1 &&
      updateKeys[0] === 'graphColor' &&
      typeof graphColor === 'string' &&
      stableGraphIds.length > 0 &&
      stableGraphIds.every((id) => id.length > 0 && isNativeElementId(id))
    ) {
      const gestureId = editGestureController.activeGestureId() ?? undefined;
      const commit = patchGraphColorsByIds(stableGraphIds, graphColor, {
        gestureId,
      });
      editGestureController.settleCommit(commit);
      void commit.catch((error) => {
        console.error('Failed to batch update graph color', error);
      });
      return;
    }
    reportElementOpSkipped(
      'batch graph property (unsupported payload or invalid target)',
    );
  };

  const handleKnobBatchSharedSetting = (updates: Partial<KnobItemPosition>) => {
    const runtimePatch = getKnobRuntimePropertyPatch(updates);
    const stableKnobIds = selectedKnobElements.map((element) => element.id);
    if (
      runtimePatch &&
      stableKnobIds.length > 0 &&
      stableKnobIds.every((id) => id.length > 0 && isNativeElementId(id))
    ) {
      const commit = patchKnobPropertiesByIds(stableKnobIds, runtimePatch);
      void commit.catch((error) => {
        console.error('Failed to batch update knob property', error);
      });
      return;
    }
    reportElementOpSkipped(
      'batch knob property (unsupported payload or invalid target)',
    );
  };

  // 정규화 진단 리포터 — 플러그인·키당 1회만 기록, empty-state 단락 경로의
  // hasRenderableSettings에도 동일 리포터를 전달해 로깅 누락 방지
  const reportPluginNormalizationError = (
    pluginId: string,
    key: string,
    error: unknown,
    kind: SettingsNormalizationErrorKind,
  ) => {
    const errorKey = `${pluginId}:${key}`;
    if (pluginVisibilityErrorsRef.current.has(errorKey)) return;
    pluginVisibilityErrorsRef.current.add(errorKey);
    const message =
      kind === 'unsupported-type'
        ? `Unsupported setting type for "${key}"`
        : `Failed to evaluate visibility for setting "${key}"`;
    console.error(`[Plugin ${pluginId}] ${message}:`, error);
  };

  const renderPluginSettingsForm = (
    schema: Parameters<typeof PluginSettingsForm>[0]['schema'],
    values: Record<string, unknown>,
    messages: Parameters<typeof PluginSettingsForm>[0]['messages'],
    pluginId: string,
    colorIdPrefix: string,
    onChange: (key: string, value: unknown) => void,
  ) => (
    <PluginSettingsForm
      schema={schema}
      values={values}
      messages={messages}
      pluginId={pluginId}
      colorIdPrefix={colorIdPrefix}
      onChange={onChange}
      locale={locale}
      panelElement={panelElement}
      reportNormalizationError={reportPluginNormalizationError}
      t={t}
    />
  );
  // 배치 편집용 interactiveRefs
  const batchColorPickerInteractiveRefs = [
    batchNoteColorButtonRef,
    batchGlowColorButtonRef,
    batchBorderColorButtonRef,
    batchCounterFillButtonRef,
  ];

  // 배치 피커 토글 - 노트 표면 로컬 상태는 useBatchNotePaint가 소유
  const handleBatchPickerToggle = (target: BatchPickerTarget) => {
    if (target && target !== batchPickerFor) {
      // 새로 열 때는 항상 대기 탭에서 시작 - 열림과 같은 배치로 리셋
      setBatchCounterColorState('idle');
      const keysData = getSelectedKeysData();
      const keyOnly = getSelectedKeyOnlyPositions();
      const firstPos =
        target === 'fill' && keyOnly.length > 0
          ? keyOnly[0].position
          : keysData[0]?.position;
      if (firstPos) {
        const counterSettings = normalizeCounterSettings(firstPos.counter);
        setBatchLocalColors({
          fillIdle: counterSettings.fill.idle,
          fillActive: counterSettings.fill.active,
        });
      }
    }
    setBatchPickerFor((prev) => (prev === target ? null : target));
  };

  // 노트 표면(note/glow/border)의 피커 색은 useBatchNotePaint가 직접 공급
  const getBatchPickerColor = (): NoteColor | string => {
    switch (batchPickerFor) {
      case 'fill':
        return effectiveBatchCounterColorState === 'active'
          ? batchLocalColors.fillActive
          : batchLocalColors.fillIdle;
      default:
        return '#FFFFFF';
    }
  };

  const getBatchPickerRef = () => {
    switch (batchPickerFor) {
      case 'noteColor':
        return batchNoteColorButtonRef;
      case 'glowColor':
        return batchGlowColorButtonRef;
      case 'borderColor':
        return batchBorderColorButtonRef;
      case 'fill':
        return batchCounterFillButtonRef;
      default:
        return null;
    }
  };

  const handleBatchPickerColorChange = (newColor: NoteColor) => {
    if (batchPickerFor !== 'fill') return;
    const solidColor = typeof newColor === 'string' ? newColor : '#FFFFFF';
    const key =
      effectiveBatchCounterColorState === 'active' ? 'fillActive' : 'fillIdle';
    setBatchLocalColors((prev) => ({
      ...prev,
      [key]: solidColor,
    }));
  };
  const handleBatchPickerColorChangeComplete = (newColor: NoteColor) =>
    handleBatchPickerColorChange(newColor);
  const handleBatchFillPickerColorChangeComplete = (
    newColor: string,
    onCounterFillCommit: (patch: EditorCounterFillPropertyPatchV1) => void,
  ) => {
    const key =
      effectiveBatchCounterColorState === 'active' ? 'fillActive' : 'fillIdle';
    setBatchLocalColors((prev) => ({ ...prev, [key]: newColor }));
    onCounterFillCommit(
      effectiveBatchCounterColorState === 'active'
        ? { property: 'counterFillActive', value: { color: newColor } }
        : { property: 'counterFillIdle', value: { color: newColor } },
    );
  };

  // ============================================================================
  // 렌더링
  // ============================================================================

  // 캔버스 선택에 묶인 구상 패널 - 프레임(글래스) 안의 루트 페이지 콘텐츠
  // 혼합 선택(네이티브+플러그인)은 총요소 기준으로 native 구성별 배치 패널에,
  // 플러그인 단독 다중은 경량 기하 배치 패널에 라우트
  const renderSelectionPanelBody = () => {
    const selectionTotalCount =
      selectedBatchStyleElements.length + selectedPluginElements.length;
    const route = resolveSelectionPanelRoute({
      keyLikeCount: selectedKeyLikeElements.length,
      graphCount: selectedGraphElements.length,
      knobCount: selectedKnobElements.length,
      pluginCount: selectedPluginElements.length,
      hasSingleKeyPosition: !!singleKeyPosition,
      hasSingleStatPosition: !!singleStatPosition,
      hasSingleGraphPosition: !!singleGraphPosition,
      hasSingleKnobPosition: !!singleKnobPosition,
    });

    // 다중 선택인 경우 (키/통계 포함, 또는 그래프+노브 혼합)
    if (route.kind === 'batchKeyLike') {
      return (
        <BatchKeyLikePanel
          setPanelElement={setPanelElement}
          totalCount={selectionTotalCount}
          selectedBatchStyleElements={selectedBatchStyleElements}
          selectedKeyElements={selectedKeyElements}
          selectedStatElements={selectedStatElements}
          selectedGraphElements={selectedGraphElements}
          selectedKnobElements={selectedKnobElements}
          selectedKeyLikeElements={selectedKeyLikeElements}
          selectedGroupInfo={selectedGroupInfo}
          isRenaming={isRenaming}
          renameInputRef={renameInputRef}
          renameValue={renameValue}
          setRenameValue={setRenameValue}
          renameCancelledRef={renameCancelledRef}
          handleRenameCommit={handleRenameCommit}
          handleRenameCancel={handleRenameCancel}
          handleRenameStart={handleRenameStart}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          handleBatchAlign={handleBatchAlign}
          handleBatchDistribute={handleBatchDistribute}
          handleBatchSpacing={handleBatchSpacing}
          handleBatchSpacingPreview={handleBatchSpacingPreview}
          handleBatchSpacingCommit={handleBatchSpacingCommit}
          getBatchSpacingValue={getBatchSpacingValue}
          handleBatchResize={handleBatchResize}
          handleBatchResizePreview={handleBatchResizePreview}
          onElementPropertyCommit={handleBatchElementPropertyCommit}
          onNoteElementPropertyCommit={handleBatchNoteElementPropertyCommit}
          handleGraphBatchSharedSetting={handleGraphBatchSharedSetting}
          getMixedValue={getMixedValue}
          getMixedValueCanonical={getMixedValueCanonical}
          getMixedValueBatch={getMixedValueBatch}
          getMixedValueGraphs={getMixedValueGraphs}
          getMixedValueGraphsAsKey={getMixedValueGraphsAsKey}
          getMixedValueKeysOnly={getMixedValueKeysOnly}
          getMixedValueActiveCapable={getMixedValueActiveCapable}
          getSelectedKeysData={getSelectedKeysData}
          getSelectedGraphsData={getSelectedGraphsData}
          getSelectedBatchStyleData={getSelectedBatchStyleData}
          getSelectedKeyOnlyPositions={getSelectedKeyOnlyPositions}
          batchScrollRefFor={batchScrollRefFor}
          batchNoteColorButtonRef={batchNoteColorButtonRef}
          batchGlowColorButtonRef={batchGlowColorButtonRef}
          batchBorderColorButtonRef={batchBorderColorButtonRef}
          batchCounterFillButtonRef={batchCounterFillButtonRef}
          batchImageButtonRef={batchImageButtonRef}
          showBatchImagePicker={showBatchImagePicker}
          setShowBatchImagePicker={setShowBatchImagePicker}
          batchPickerFor={batchPickerFor}
          setBatchPickerFor={setBatchPickerFor}
          batchCounterColorState={effectiveBatchCounterColorState}
          setBatchCounterColorState={setBatchCounterColorState}
          batchLocalColors={batchLocalColors}
          setBatchLocalColors={setBatchLocalColors}
          handleBatchPickerToggle={handleBatchPickerToggle}
          handleBatchPickerColorChange={handleBatchPickerColorChange}
          handleBatchPickerColorChangeComplete={
            handleBatchPickerColorChangeComplete
          }
          handleBatchFillPickerColorChangeComplete={
            handleBatchFillPickerColorChangeComplete
          }
          getBatchPickerColor={getBatchPickerColor}
          getBatchPickerRef={getBatchPickerRef}
          batchColorPickerInteractiveRefs={batchColorPickerInteractiveRefs}
          panelElement={panelElement}
          useCustomCSS={useCustomCSS}
          selectedKeyType={selectedKeyType}
          t={t}
        />
      );
    }

    // 다중 선택인 경우 (노브 요소만)
    if (route.kind === 'batchKnobOnly') {
      return (
        <BatchKnobOnlyPanel
          setPanelElement={setPanelElement}
          totalCount={selectionTotalCount}
          selectedKnobElements={selectedKnobElements}
          selectedGroupInfo={selectedGroupInfo}
          isRenaming={isRenaming}
          renameInputRef={renameInputRef}
          renameValue={renameValue}
          setRenameValue={setRenameValue}
          renameCancelledRef={renameCancelledRef}
          handleRenameCommit={handleRenameCommit}
          handleRenameCancel={handleRenameCancel}
          handleRenameStart={handleRenameStart}
          handleBatchAlign={handleBatchAlign}
          handleBatchDistribute={handleBatchDistribute}
          handleBatchSpacing={handleBatchSpacing}
          handleBatchSpacingPreview={handleBatchSpacingPreview}
          handleBatchSpacingCommit={handleBatchSpacingCommit}
          getBatchSpacingValue={getBatchSpacingValue}
          handleBatchResize={handleBatchResize}
          handleBatchResizePreview={handleBatchResizePreview}
          onElementPropertyCommit={handleBatchElementPropertyCommit}
          handleKnobBatchSharedSetting={handleKnobBatchSharedSetting}
          getMixedValueKnobs={getMixedValueKnobs}
          getMixedValueKnobsAsKey={getMixedValueKnobsAsKey}
          getSelectedKnobsData={getSelectedKnobsData}
          batchScrollRefFor={batchScrollRefFor}
          batchImageButtonRef={batchImageButtonRef}
          showBatchImagePicker={showBatchImagePicker}
          setShowBatchImagePicker={setShowBatchImagePicker}
          panelElement={panelElement}
          useCustomCSS={useCustomCSS}
          selectedKeyType={selectedKeyType}
          t={t}
        />
      );
    }

    // 다중 선택인 경우 (그래프 요소만)
    if (route.kind === 'batchGraphOnly') {
      return (
        <BatchGraphOnlyPanel
          setPanelElement={setPanelElement}
          totalCount={selectionTotalCount}
          selectedGraphElements={selectedGraphElements}
          selectedGroupInfo={selectedGroupInfo}
          isRenaming={isRenaming}
          renameInputRef={renameInputRef}
          renameValue={renameValue}
          setRenameValue={setRenameValue}
          renameCancelledRef={renameCancelledRef}
          handleRenameCommit={handleRenameCommit}
          handleRenameCancel={handleRenameCancel}
          handleRenameStart={handleRenameStart}
          handleBatchAlign={handleBatchAlign}
          handleBatchDistribute={handleBatchDistribute}
          handleBatchSpacing={handleBatchSpacing}
          handleBatchSpacingPreview={handleBatchSpacingPreview}
          handleBatchSpacingCommit={handleBatchSpacingCommit}
          getBatchSpacingValue={getBatchSpacingValue}
          handleBatchResize={handleBatchResize}
          handleBatchResizePreview={handleBatchResizePreview}
          onElementPropertyCommit={handleBatchElementPropertyCommit}
          handleGraphBatchSharedSetting={handleGraphBatchSharedSetting}
          getMixedValueGraphs={getMixedValueGraphs}
          getMixedValueGraphsAsKey={getMixedValueGraphsAsKey}
          getSelectedGraphsData={getSelectedGraphsData}
          batchScrollRefFor={batchScrollRefFor}
          batchImageButtonRef={batchImageButtonRef}
          showBatchImagePicker={showBatchImagePicker}
          setShowBatchImagePicker={setShowBatchImagePicker}
          panelElement={panelElement}
          useCustomCSS={useCustomCSS}
          selectedKeyType={selectedKeyType}
          t={t}
        />
      );
    }

    // 플러그인 단독 다중 선택 - 정렬·분배·간격만 있는 경량 기하 배치
    if (route.kind === 'pluginBatch') {
      return (
        <BatchPluginOnlyPanel
          setPanelElement={setPanelElement}
          totalCount={selectionTotalCount}
          selectedGroupInfo={selectedGroupInfo}
          isRenaming={isRenaming}
          renameInputRef={renameInputRef}
          renameValue={renameValue}
          setRenameValue={setRenameValue}
          renameCancelledRef={renameCancelledRef}
          handleRenameCommit={handleRenameCommit}
          handleRenameCancel={handleRenameCancel}
          handleRenameStart={handleRenameStart}
          handleBatchAlign={handleBatchAlign}
          handleBatchDistribute={handleBatchDistribute}
          handleBatchSpacing={handleBatchSpacing}
          handleBatchSpacingCommit={handleBatchSpacingCommit}
          getBatchSpacingValue={getBatchSpacingValue}
          batchScrollRefFor={batchScrollRefFor}
          t={t}
        />
      );
    }

    // 플러그인 요소만 선택된 경우
    if (route.kind === 'plugin') {
      const pluginTitle =
        selectedPluginDefinition?.name ||
        selectedPluginElement?.definitionId ||
        t('propertiesPanel.pluginElement') ||
        'Plugin';

      return (
        <PluginSelectionPanel
          setPanelElement={setPanelElement}
          pluginTitle={pluginTitle}
          setPluginScrollRef={setPluginScrollRef}
          isPluginResizable={isPluginResizable}
          selectedPluginElement={selectedPluginElement}
          pluginDisplaySize={pluginDisplaySize}
          handlePluginGeometryPreview={pluginGeometryGesture.preview}
          handlePluginGeometryCommit={pluginGeometryGesture.commit}
          handlePluginGeometryCancel={pluginGeometryGesture.cancel}
          hasSinglePluginSelection={hasSinglePluginSelection}
          showModalHint={showModalHint}
          showSettings={showSettings}
          renderPluginSettingsForm={renderPluginSettingsForm}
          reportNormalizationError={reportPluginNormalizationError}
          selectedPluginDefinition={selectedPluginDefinition}
          resolvedPluginSettings={resolvedPluginSettings}
          handlePluginSettingChange={handlePluginSettingChange}
          t={t}
        />
      );
    }

    // 단일 노브 요소 선택인 경우
    if (route.kind === 'singleKnob' && singleKnobPosition) {
      return (
        <SingleKnobPanel
          setPanelElement={setPanelElement}
          singleKnobPosition={singleKnobPosition}
          selectedKeyType={selectedKeyType}
          isRenaming={isRenaming}
          renameInputRef={renameInputRef}
          renameValue={renameValue}
          setRenameValue={setRenameValue}
          renameCancelledRef={renameCancelledRef}
          handleRenameCommit={handleRenameCommit}
          handleRenameCancel={handleRenameCancel}
          handleRenameStart={handleRenameStart}
          onElementPropertyCommit={stableElementPropertyCommitHandler(
            'knob',
            selectedKnobElements[0]?.id,
          )}
          onInactiveImageCommit={stableInactiveImageHandler(
            'knob',
            selectedKnobElements[0]?.id,
          )}
          onActiveImageCommit={stableActiveImageHandler(
            'knob',
            selectedKnobElements[0]?.id,
          )}
          onIdleTransparentCommit={stableIdleTransparentHandler(
            'knob',
            selectedKnobElements[0]?.id,
          )}
          onActiveTransparentCommit={stableActiveTransparentHandler(
            'knob',
            selectedKnobElements[0]?.id,
          )}
          onIdleImageFitCommit={stableIdleImageFitHandler(
            'knob',
            selectedKnobElements[0]?.id,
          )}
          onActiveImageFitCommit={stableActiveImageFitHandler(
            'knob',
            selectedKnobElements[0]?.id,
          )}
          handleGeometryPreview={stableGeometryPreviewHandler(
            'knob',
            selectedKnobElements[0]?.id,
          )}
          handleGeometryCommit={stableGeometryHandler(
            'knob',
            selectedKnobElements[0]?.id,
          )}
          onStylePropertyCommit={stableStylePropertyCommitHandler(
            'knob',
            selectedKnobElements[0]?.id,
          )}
          onPaintPreview={stablePaintPreviewHandler(
            'knob',
            selectedKnobElements[0]?.id,
          )}
          onPaintCommit={stablePaintCommitHandler(
            'knob',
            selectedKnobElements[0]?.id,
          )}
          onStylePropertyPreview={stableStylePropertyPreviewHandler(
            'knob',
            selectedKnobElements[0]?.id,
          )}
          onShadowCommit={stableShadowCommitHandler(
            'knob',
            selectedKnobElements[0]?.id,
          )}
          singleScrollRefFor={singleScrollRefFor}
          panelElement={panelElement}
          useCustomCSS={useCustomCSS}
          t={t}
        />
      );
    }

    // 단일 그래프 요소 선택인 경우
    if (route.kind === 'singleGraph' && singleGraphPosition) {
      return (
        <SingleGraphPanel
          setPanelElement={setPanelElement}
          singleGraphPosition={singleGraphPosition}
          selectedKeyType={selectedKeyType}
          isRenaming={isRenaming}
          renameInputRef={renameInputRef}
          renameValue={renameValue}
          setRenameValue={setRenameValue}
          renameCancelledRef={renameCancelledRef}
          handleRenameCommit={handleRenameCommit}
          handleRenameCancel={handleRenameCancel}
          handleRenameStart={handleRenameStart}
          onElementPropertyCommit={stableElementPropertyCommitHandler(
            'graph',
            selectedGraphElements[0]?.id,
          )}
          onGraphColorPreview={
            selectedGraphElements[0]?.id &&
            isNativeElementId(selectedGraphElements[0].id)
              ? (color) =>
                  previewSingleGraphColor(selectedGraphElements[0].id, color)
              : undefined
          }
          onInactiveImageCommit={stableInactiveImageHandler(
            'graph',
            selectedGraphElements[0]?.id,
          )}
          onIdleTransparentCommit={stableIdleTransparentHandler(
            'graph',
            selectedGraphElements[0]?.id,
          )}
          onIdleImageFitCommit={stableIdleImageFitHandler(
            'graph',
            selectedGraphElements[0]?.id,
          )}
          handleGeometryPreview={stableGeometryPreviewHandler(
            'graph',
            selectedGraphElements[0]?.id,
          )}
          handleGeometryCommit={stableGeometryHandler(
            'graph',
            selectedGraphElements[0]?.id,
          )}
          onStylePropertyCommit={stableStylePropertyCommitHandler(
            'graph',
            selectedGraphElements[0]?.id,
          )}
          onPaintCommit={stablePaintCommitHandler(
            'graph',
            selectedGraphElements[0]?.id,
          )}
          onPaintPreview={stablePaintPreviewHandler(
            'graph',
            selectedGraphElements[0]?.id,
          )}
          singleScrollRefFor={singleScrollRefFor}
          showGraphImagePicker={showGraphImagePicker}
          setShowGraphImagePicker={setShowGraphImagePicker}
          graphImageButtonRef={graphImageButtonRef}
          graphClassNameDraft={graphClassNameDraft}
          setGraphClassNameDraft={setGraphClassNameDraft}
          panelElement={panelElement}
          useCustomCSS={useCustomCSS}
          t={t}
        />
      );
    }

    // 단일 키/통계 요소 선택인 경우
    const isSingleStat = !singleKeyPosition && !!singleStatPosition;
    const isSingleKey = !!singleKeyPosition;
    if (route.kind !== 'singleKeyStat' || (!isSingleKey && !isSingleStat)) {
      return null;
    }

    return (
      <SingleKeyStatPanel
        setPanelElement={setPanelElement}
        isSingleStat={isSingleStat}
        isSingleKey={isSingleKey}
        singleKeyIndex={singleKeyIndex}
        singleStatIndex={singleStatIndex}
        singleKeyPosition={singleKeyPosition}
        canonicalKeyPosition={singleCanonicalKeyPosition}
        singleStatPosition={singleStatPosition}
        singleKeyCode={singleKeyCode}
        singleKeySlot={singleKeySlot}
        singleKeyInfo={singleKeyInfo}
        selectedKeyType={selectedKeyType}
        isRenaming={isRenaming}
        renameInputRef={renameInputRef}
        renameValue={renameValue}
        setRenameValue={setRenameValue}
        renameCancelledRef={renameCancelledRef}
        handleRenameCommit={handleRenameCommit}
        handleRenameCancel={handleRenameCancel}
        handleRenameStart={handleRenameStart}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onKeyMappingChange={onKeyMappingChange}
        localState={localState}
        setLocalState={setLocalState}
        handleGeometryPreview={stableGeometryPreviewHandler(
          isSingleStat ? 'stat' : 'key',
          isSingleStat
            ? selectedStatElements[0]?.id
            : selectedKeyElements[0]?.id,
        )}
        onElementPropertyCommit={stableElementPropertyCommitHandler(
          isSingleStat ? 'stat' : 'key',
          isSingleStat
            ? selectedStatElements[0]?.id
            : selectedKeyElements[0]?.id,
        )}
        onInactiveImageCommit={stableInactiveImageHandler(
          isSingleStat ? 'stat' : 'key',
          isSingleStat
            ? selectedStatElements[0]?.id
            : selectedKeyElements[0]?.id,
        )}
        onActiveImageCommit={
          isSingleKey
            ? stableActiveImageHandler('key', selectedKeyElements[0]?.id)
            : undefined
        }
        onIdleTransparentCommit={stableIdleTransparentHandler(
          isSingleStat ? 'stat' : 'key',
          isSingleStat
            ? selectedStatElements[0]?.id
            : selectedKeyElements[0]?.id,
        )}
        onActiveTransparentCommit={
          isSingleKey
            ? stableActiveTransparentHandler('key', selectedKeyElements[0]?.id)
            : undefined
        }
        onIdleImageFitCommit={stableIdleImageFitHandler(
          isSingleStat ? 'stat' : 'key',
          isSingleStat
            ? selectedStatElements[0]?.id
            : selectedKeyElements[0]?.id,
        )}
        onActiveImageFitCommit={
          isSingleKey
            ? stableActiveImageFitHandler('key', selectedKeyElements[0]?.id)
            : undefined
        }
        onSoundPathCommit={
          isSingleKey
            ? stableSoundPathHandler(selectedKeyElements[0]?.id)
            : undefined
        }
        onSoundEnabledCommit={
          isSingleKey
            ? stableSoundEnabledHandler(selectedKeyElements[0]?.id)
            : undefined
        }
        onSoundVolumeCommit={
          isSingleKey
            ? stableSoundVolumeHandler(selectedKeyElements[0]?.id)
            : undefined
        }
        onStylePropertyPreview={stableStylePropertyPreviewHandler(
          isSingleStat ? 'stat' : 'key',
          isSingleStat
            ? selectedStatElements[0]?.id
            : selectedKeyElements[0]?.id,
        )}
        onStylePropertyCommit={stableStylePropertyCommitHandler(
          isSingleStat ? 'stat' : 'key',
          isSingleStat
            ? selectedStatElements[0]?.id
            : selectedKeyElements[0]?.id,
          { settleGesture: true },
        )}
        onPaintPreview={stablePaintPreviewHandler(
          isSingleStat ? 'stat' : 'key',
          isSingleStat
            ? selectedStatElements[0]?.id
            : selectedKeyElements[0]?.id,
        )}
        onPaintCommit={stablePaintCommitHandler(
          isSingleStat ? 'stat' : 'key',
          isSingleStat
            ? selectedStatElements[0]?.id
            : selectedKeyElements[0]?.id,
        )}
        onShadowCommit={stableShadowCommitHandler(
          isSingleStat ? 'stat' : 'key',
          isSingleStat
            ? selectedStatElements[0]?.id
            : selectedKeyElements[0]?.id,
        )}
        onNotePaintCommit={
          isSingleKey
            ? stableNotePaintCommitHandler(selectedKeyElements[0]?.id)
            : undefined
        }
        onNotePaintPreview={
          isSingleKey
            ? stableNotePaintPreviewHandler(selectedKeyElements[0]?.id)
            : undefined
        }
        onCounterAnimationPresetCommit={stableCounterAnimationPresetHandler(
          isSingleStat ? 'stat' : 'key',
          isSingleStat
            ? selectedStatElements[0]?.id
            : selectedKeyElements[0]?.id,
        )}
        onCounterEnabledCommit={stableCounterEnabledHandler(
          isSingleStat ? 'stat' : 'key',
          isSingleStat
            ? selectedStatElements[0]?.id
            : selectedKeyElements[0]?.id,
        )}
        onCounterAnimationEnabledCommit={stableCounterAnimationEnabledHandler(
          isSingleStat ? 'stat' : 'key',
          isSingleStat
            ? selectedStatElements[0]?.id
            : selectedKeyElements[0]?.id,
        )}
        onCounterLayoutCommit={stableCounterLayoutHandler(
          isSingleStat ? 'stat' : 'key',
          isSingleStat
            ? selectedStatElements[0]?.id
            : selectedKeyElements[0]?.id,
        )}
        onCounterTypographyCommit={stableCounterTypographyHandler(
          isSingleStat ? 'stat' : 'key',
          isSingleStat
            ? selectedStatElements[0]?.id
            : selectedKeyElements[0]?.id,
        )}
        onCounterFillCommit={stableCounterFillHandler(
          isSingleStat ? 'stat' : 'key',
          isSingleStat
            ? selectedStatElements[0]?.id
            : selectedKeyElements[0]?.id,
        )}
        handleGeometryCommit={stableGeometryHandler(
          isSingleStat ? 'stat' : 'key',
          isSingleStat
            ? selectedStatElements[0]?.id
            : selectedKeyElements[0]?.id,
        )}
        showImagePicker={showImagePicker}
        setShowImagePicker={setShowImagePicker}
        imageButtonRef={imageButtonRef}
        panelElement={panelElement}
        useCustomCSS={useCustomCSS}
        singleScrollRefFor={singleScrollRefFor}
        t={t}
      />
    );
  };

  // 캔버스 선택에 묶이지 않는 뷰는 EditSessionScope 밖에 둔다.
  // 플러그인 설정 세션의 색상 피커까지 대상 전환 억제를 걸면, 무관한 캔버스 선택
  // 변경 뒤에 피커가 닫힐 때 멀쩡한 색 편집이 폐기된다
  const renderPanelBody = () => {
    if (pluginSettingsPanel) {
      return (
        <PluginSettingsPanelView
          setPanelElement={setPanelElement}
          pluginSettingsPanel={pluginSettingsPanel}
          pluginPanelSettings={pluginPanelSettings}
          handlePluginSettingsPanelChange={handlePluginSettingsPanelChange}
          handlePluginSettingsPanelConfirm={handlePluginSettingsPanelConfirm}
          isSaving={isPluginSettingsSaving}
          setPluginScrollRef={setPluginScrollRef}
          renderPluginSettingsForm={renderPluginSettingsForm}
          reportNormalizationError={reportPluginNormalizationError}
          t={t}
        />
      );
    }

    // 레이어 모드일 때는 선택 여부와 관계없이 레이어 패널 표시
    if (panelMode === 'layer') {
      return (
        <LayerPanel
          onSwitchToProperty={handleToggleMode}
          onSelectionFromPanel={() => {
            selectionFromLayerPanelRef.current = true;
          }}
        />
      );
    }

    // 선택된 키 요소가 없으면 레이어 패널 표시
    if (selectedKeyElements.length === 0 && selectedElements.length === 0) {
      return (
        <LayerPanel
          onSwitchToProperty={handleToggleMode}
          onSelectionFromPanel={() => {
            selectionFromLayerPanelRef.current = true;
          }}
        />
      );
    }

    return <EditSessionScope>{renderSelectionPanelBody()}</EditSessionScope>;
  };

  // 열림/닫힘과 무관하게 항상 렌더되는 지속 토글 — 리마운트 없이 모프 전환
  const toggleButton = (
    <PanelToggleButton
      open={showFrame}
      onClick={
        pluginSettingsPanel
          ? handlePluginSettingsPanelCancel
          : handleTogglePanel
      }
    />
  );

  const panelBody = showFrame ? renderPanelBody() : null;

  // 헤더 액션 기준 모드 — panelMode가 property여도 선택이 없으면 레이어 뷰가 표시됨
  const hasAnySelection =
    selectedKeyElements.length > 0 || selectedElements.length > 0;
  const displayedPanelMode =
    panelMode === 'layer' || !hasAnySelection ? 'layer' : 'property';

  // 프레임이 글래스를 소유하고, 루트/서브 페이지가 그 안에서 슬라이드 전환.
  // 열림/닫힘 모두 같은 프래그먼트 구조 유지 — 토글 버튼이 리마운트되면
  // 호버 상태가 끊겨 아이콘이 깜빡임
  return (
    <>
      {showFrame && panelBody && (
        <PanelNavProvider
          value={{
            activePageKey,
            renderPageKey,
            openPage,
            closePage,
            pageHost,
          }}
        >
          <div
            data-dmn-panel-frame=""
            className={
              frameVariant === 'window'
                ? WINDOW_PANEL_FRAME_CLASS
                : SIDE_PANEL_FRAME_CLASS
            }
          >
            {/* inert — 슬라이드 아웃된 레이어를 키보드 탭 순회·접근성 트리에서 제외 */}
            <div
              className="dmn-panel-page"
              data-page-depth="root"
              data-active={activePageKey ? 'false' : 'true'}
              inert={activePageKey ? true : undefined}
            >
              {panelBody}
              <PanelHeaderActions
                mode={displayedPanelMode}
                modeToggleHidden={!!pluginSettingsPanel}
                modeToggleDisabled={
                  displayedPanelMode === 'layer' && !hasAnySelection
                }
                onToggleMode={handleToggleMode}
                detachAction={detachAction}
                onDetachAction={onDetachAction}
                edgeAligned={frameVariant === 'window'}
              />
            </div>
            <div
              ref={setPageHost}
              className="dmn-panel-page"
              data-page-depth="sub"
              data-active={activePageKey ? 'true' : 'false'}
              inert={activePageKey ? undefined : true}
            />
          </div>
        </PanelNavProvider>
      )}
      {frameVariant !== 'window' && toggleButton}
    </>
  );
};

export default PropertiesPanel;
