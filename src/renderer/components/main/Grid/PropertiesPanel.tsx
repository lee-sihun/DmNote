import React, { useEffect, useState, useRef } from 'react';
import { useTranslation } from '@contexts/useTranslation';
import { usePanelHost } from '@contexts/PanelHostContext';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { useSettingsStore } from '@stores/useSettingsStore';
import { usePropertiesPanelStore } from '@stores/grid/usePropertiesPanelStore';
import {
  getDefaultSettings,
  omitLayoutSettingValues,
  type SettingsNormalizationErrorKind,
} from '@plugins/runtime/settingsSections';
import { updatePluginElement } from '@plugins/runtime/displayElement/pluginElementActions';
import type { KeyPosition } from '@src/types/key/keys';
import { useLenis } from '@hooks/useLenis';
import { usePluginGeometryGesture } from '@hooks/Grid/usePluginGeometryGesture';
import { isNativeElementId } from '@src/renderer/editor/model/elementId';

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
  usePanelScroll,
} from './PropertiesPanel/index';
import {
  SIDE_PANEL_FRAME_CLASS,
  WINDOW_PANEL_FRAME_CLASS,
} from './PropertiesPanel/navigation/panelChrome';
import { resolveSelectionPanelRoute } from './PropertiesPanel/selection/selectionPanelRoute';
import { PanelNavProvider } from './PropertiesPanel/navigation/PanelNavContext';
import PanelHeaderActions from './PropertiesPanel/navigation/PanelHeaderActions';
import PanelToggleButton from './PropertiesPanel/navigation/PanelToggleButton';
import { EditSessionScope } from '@src/renderer/contexts/EditSessionScope';
import { previewSingleGraphColor } from './PropertiesPanel/selection/previewPatchForwarders';
import PluginSettingsForm from './PropertiesPanel/plugin/PluginSettingsForm';
import { usePropertiesPanelSelection } from './PropertiesPanel/selection/usePropertiesPanelSelection';
import { usePanelNavigation } from './PropertiesPanel/navigation/usePanelNavigation';
import { createBatchSelectionModel } from './PropertiesPanel/batch/batchSelectionModel';
import { singleSelectionHandlers } from './PropertiesPanel/selection/singleSelectionHandlers';
import { shouldNormalizePropertyTabToStyle } from './PropertiesPanel/selection/propertyPanelAdapters';
import { usePropertiesPanelRename } from './PropertiesPanel/navigation/usePropertiesPanelRename';
import { usePluginSettingsPanelController } from './PropertiesPanel/plugin/usePluginSettingsPanelController';
import { usePropertiesPanelVisibility } from './PropertiesPanel/navigation/usePropertiesPanelVisibility';
import { usePropertiesPanelBatchGeometry } from './PropertiesPanel/batch/usePropertiesPanelBatchGeometry';
import { usePropertiesPanelBatchCommitHandlers } from './PropertiesPanel/batch/usePropertiesPanelBatchCommitHandlers';
import { useBatchColorPickerController } from './PropertiesPanel/batch/useBatchColorPickerController';

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
  const { useCustomCSS } = useSettingsStore();
  const {
    pluginSettingsPanel,
    pluginPanelSettings,
    isPluginSettingsSaving,
    cancelRef: handlePluginSettingsPanelCancelImpl,
    handleChange: handlePluginSettingsPanelChange,
    handleConfirm: handlePluginSettingsPanelConfirm,
    handleCancel: handlePluginSettingsPanelCancel,
  } = usePluginSettingsPanelController();
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

  // 이미지 픽커 상태
  const [showImagePicker, setShowImagePicker] = useState(false);
  const imageButtonRef = useRef<HTMLButtonElement>(null);
  const [showGraphImagePicker, setShowGraphImagePicker] = useState(false);
  const graphImageButtonRef = useRef<HTMLButtonElement>(null);
  const [graphClassNameDraft, setGraphClassNameDraft] = useState('');

  // 다중 선택용 이미지 픽커 상태
  const [showBatchImagePicker, setShowBatchImagePicker] = useState(false);
  const batchImageButtonRef = useRef<HTMLButtonElement>(null);

  // 패널 ref (컬러픽커/이미지픽커 위치 기준)
  const [panelElement, setPanelElement] = useState<HTMLDivElement | null>(null);

  // 패널 모드 (layer: 레이어 패널, property: 속성 패널)
  // 설정 왕복으로 리마운트돼도 열림 상태와 함께 보존되도록 store에 유지
  const panelMode = usePropertiesPanelStore((state) => state.canvasPanelMode);
  const setPanelMode = usePropertiesPanelStore(
    (state) => state.setCanvasPanelMode,
  );

  const activeTab = usePropertiesPanelStore(
    (state) => state.propertyPanelActiveTab,
  );
  const setActiveTab = usePropertiesPanelStore(
    (state) => state.setPropertyPanelActiveTab,
  );

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
  const {
    isRenaming,
    renameValue,
    setRenameValue,
    renameInputRef,
    renameCancelledRef,
    handleRenameStart,
    handleRenameCommit,
    handleRenameCancel,
  } = usePropertiesPanelRename({
    selectedElements,
    selectedKeyType,
    selectedGroupInfo,
    singleKeyPosition,
    singleStatPosition,
    singleGraphPosition,
    singleKnobPosition,
    singleKeyInfo,
    singleKeyCode,
    setPanelMode,
  });

  // 스크롤 훅 사용
  const { batchScrollRefFor, singleScrollRefFor } = usePanelScroll();

  // 플러그인 패널 스크롤
  const { scrollContainerRef: setPluginScrollRef } = useLenis();

  const {
    batchNoteColorButtonRef,
    batchGlowColorButtonRef,
    batchBorderColorButtonRef,
    batchCounterFillButtonRef,
    batchPickerFor,
    setBatchPickerFor,
    effectiveBatchCounterColorState,
    setBatchCounterColorState,
    batchLocalColors,
    setBatchLocalColors,
    batchColorPickerInteractiveRefs,
    handleBatchPickerToggle,
    getBatchPickerColor,
    getBatchPickerRef,
    handleBatchPickerColorChange,
    handleBatchPickerColorChangeComplete,
    handleBatchFillPickerColorChangeComplete,
  } = useBatchColorPickerController({
    selectedKeyCount: selectedKeyElements.length,
    getSelectedKeysData,
    getSelectedKeyOnlyPositions,
  });

  // 선택이 변경되면 로컬 상태 초기화
  useEffect(() => {
    const targetPosition = singleKeyPosition || singleStatPosition;
    if (targetPosition) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 선택 대상의 편집 draft 동기화
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 선택 그래프의 입력 draft 동기화
    setGraphClassNameDraft(singleGraphPosition?.className || '');
  }, [selectedKeyType, singleGraphIndex, singleGraphPosition?.className]);

  const { selectionFromLayerPanelRef, handleTogglePanel } =
    usePropertiesPanelVisibility({
      frameVariant,
      isPanelVisible,
      setIsPanelVisible,
      panelMode,
      setPanelMode,
      selectedKeyType,
      singleKeyIndex,
      selectedElements,
      selectedKeyElementsLength: selectedKeyElements.length,
      selectedKeyLikeElementsLength: selectedKeyLikeElements.length,
      selectedBatchStyleElementsLength: selectedBatchStyleElements.length,
      selectedPluginElementsLength: selectedPluginElements.length,
      pluginSettingsPanel,
      closePage,
      setShowImagePicker,
      setShowGraphImagePicker,
      setShowBatchImagePicker,
      setBatchPickerFor,
    });

  // ============================================================================
  // 핸들러
  // ============================================================================

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
  } = usePropertiesPanelBatchGeometry({
    selectedKeyType,
    positions,
    statItemPositions,
    graphItemPositions,
    knobItemPositions,
    selectedBatchStyleElements,
    stableBatchGeometryTargets,
    stablePluginGeometryElements,
    stablePluginGeometryTargets,
  });

  const {
    handleBatchElementPropertyCommit,
    handleBatchNoteElementPropertyCommit,
    handleGraphBatchSharedSetting,
    handleKnobBatchSharedSetting,
  } = usePropertiesPanelBatchCommitHandlers({
    selectedBatchStyleElements,
    selectedKeyElements,
    selectedGraphElements,
    selectedKnobElements,
  });

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
