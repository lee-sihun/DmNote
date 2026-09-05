import React from 'react';
import type { KeyPosition, NoteColor } from '@src/types/key/keys';
import type { GraphItemPosition } from '@src/types/key/graphItems';
import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import { useEditStatePreviewPublisher } from '@stores/grid/useEditStatePreviewStore';
import { PANEL_ROOT_CLASS } from '../navigation/panelChrome';
import {
  normalizeCounterSettings,
  createDefaultCounterSettings,
} from '@src/types/key/keys';
import {
  Tabs,
  BatchStyleTabContent,
  BatchNoteTabContent,
  BatchCounterTabContent,
  TABS,
  TabType,
} from '../index';
import EditSessionBoundary from '../selection/EditSessionBoundary';
import { editGestureController } from '@src/renderer/editor/runtime/gesture/editGestureController';
import {
  captureBatchElementBinding,
  useBatchElementBinding,
} from '@hooks/pickers/useBatchElementBinding';
import { usePanelNav } from '../navigation/PanelNavContext';
import { BATCH_COUNTER_ANIMATION_PAGE_KEY } from './BatchCounterTabContent';
import type { EditorCounterFillPropertyPatchV1 } from '@src/types/editor';
import { hexWithAlphaPercent } from '@utils/color/colorUtils';
import type { BatchElementPropertyUpdate } from '../types';
import { useBatchNotePaint, type BatchNoteSurface } from './useBatchNotePaint';
import BatchPanelHeader from './BatchPanelHeader';
import BatchImagePickerPopup from './BatchImagePickerPopup';
import BatchColorPickerPopup from './BatchColorPickerPopup';
import BatchGraphSettingsSection from './BatchGraphSettingsSection';
import { createBatchGraphSettingsModel } from './batchGraphSettingsModel';
import { useBatchKeyLikeCommitRuntime } from './useBatchKeyLikeCommitRuntime';
import {
  commitBoundActiveImage,
  commitBoundActiveTransparent,
  commitBoundIdleTransparent,
  commitBoundInactiveImage,
  commitBoundSoundPath,
  type BatchLocalColors,
  type BatchPickerTarget,
  type KeyData,
  type MixedValueGetter,
  type MixedValueResult,
} from './batchPanelShared';

interface BatchKeyLikePanelProps {
  setPanelElement: (el: HTMLDivElement | null) => void;
  // native+plugin 합산 개수 - 헤더 표시·분배 게이트 (미전달 시 native 개수)
  totalCount?: number;
  selectedBatchStyleElements: SelectedElement[];
  selectedKeyElements: SelectedElement[];
  selectedStatElements: SelectedElement[];
  selectedGraphElements: SelectedElement[];
  selectedKnobElements: SelectedElement[];
  selectedKeyLikeElements: SelectedElement[];
  selectedGroupInfo: { id: string; name: string; memberCount: number } | null;
  isRenaming: boolean;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  renameValue: string;
  setRenameValue: (value: string) => void;
  renameCancelledRef: React.MutableRefObject<boolean>;
  handleRenameCommit: (value: string) => void;
  handleRenameCancel: () => void;
  handleRenameStart: () => void;
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  // batch handlers
  handleBatchAlign: (
    direction: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom',
  ) => void;
  handleBatchDistribute: (direction: 'horizontal' | 'vertical') => void;
  handleBatchSpacing: (
    spacing: number,
    options?: { gestureId?: string; deferSave?: boolean },
  ) => void;
  handleBatchSpacingPreview: (spacing: number) => void;
  handleBatchSpacingCommit: (
    spacing: number,
    options?: { gestureId?: string; deferSave?: boolean },
  ) => void;
  getBatchSpacingValue: () => MixedValueResult<number>;
  handleBatchResize: (dimension: 'width' | 'height', value: number) => void;
  handleBatchResizePreview: (
    dimension: 'width' | 'height',
    value: number,
  ) => void;
  onElementPropertyCommit?: (
    updates: BatchElementPropertyUpdate,
    options?: { gestureId?: string },
  ) => void;
  onNoteElementPropertyCommit?: (updates: BatchElementPropertyUpdate) => void;
  handleGraphBatchSharedSetting: (updates: Partial<GraphItemPosition>) => void;
  // mixed value getters
  getMixedValue: MixedValueGetter<KeyPosition>;
  /** 프리뷰가 섞이지 않은 canonical 기준. 게스처 취소 뒤 로컬 복원용 */
  getMixedValueCanonical: MixedValueGetter<KeyPosition>;
  getMixedValueBatch: MixedValueGetter<KeyPosition>;
  getMixedValueGraphs: MixedValueGetter<GraphItemPosition>;
  getMixedValueGraphsAsKey: MixedValueGetter<KeyPosition>;
  getMixedValueKeysOnly: MixedValueGetter<KeyPosition>;
  getMixedValueActiveCapable: MixedValueGetter<KeyPosition>;
  getSelectedKeysData: () => KeyData[];
  getSelectedGraphsData: () => KeyData[];
  getSelectedBatchStyleData: () => KeyData[];
  getSelectedKeyOnlyPositions: () => { index: number; position: KeyPosition }[];
  // refs
  batchScrollRefFor: (tab: TabType) => (node: HTMLDivElement | null) => void;
  batchNoteColorButtonRef: React.RefObject<HTMLButtonElement | null>;
  batchGlowColorButtonRef: React.RefObject<HTMLButtonElement | null>;
  batchBorderColorButtonRef: React.RefObject<HTMLButtonElement | null>;
  batchCounterFillButtonRef: React.RefObject<HTMLButtonElement | null>;
  batchImageButtonRef: React.RefObject<HTMLButtonElement | null>;
  // state
  showBatchImagePicker: boolean;
  setShowBatchImagePicker: (value: boolean) => void;
  batchPickerFor: BatchPickerTarget;
  setBatchPickerFor: (value: BatchPickerTarget) => void;
  batchCounterColorState: 'idle' | 'active';
  setBatchCounterColorState: (value: 'idle' | 'active') => void;
  batchLocalColors: BatchLocalColors;
  setBatchLocalColors: React.Dispatch<React.SetStateAction<BatchLocalColors>>;
  handleBatchPickerToggle: (target: BatchPickerTarget) => void;
  handleBatchPickerColorChange: (newColor: NoteColor) => void;
  handleBatchPickerColorChangeComplete: (newColor: NoteColor) => void;
  handleBatchFillPickerColorChangeComplete: (
    newColor: string,
    onCounterFillCommit: (patch: EditorCounterFillPropertyPatchV1) => void,
  ) => void;
  getBatchPickerColor: () => NoteColor | string;
  getBatchPickerRef: () => React.RefObject<HTMLButtonElement | null> | null;
  batchColorPickerInteractiveRefs: React.RefObject<HTMLButtonElement | null>[];
  panelElement: HTMLDivElement | null;
  useCustomCSS: boolean;
  selectedKeyType: string;
  t: (key: string) => string | undefined;
}

export const BatchKeyLikePanel: React.FC<BatchKeyLikePanelProps> = ({
  setPanelElement,
  totalCount,
  selectedBatchStyleElements,
  selectedKeyElements,
  selectedStatElements,
  selectedKnobElements,
  selectedGraphElements,
  selectedKeyLikeElements,
  selectedGroupInfo,
  isRenaming,
  renameInputRef,
  renameValue,
  setRenameValue,
  renameCancelledRef,
  handleRenameCommit,
  handleRenameCancel,
  handleRenameStart,
  activeTab,
  setActiveTab,
  handleBatchAlign,
  handleBatchDistribute,
  handleBatchSpacing,
  handleBatchSpacingPreview,
  handleBatchSpacingCommit,
  getBatchSpacingValue,
  handleBatchResize,
  handleBatchResizePreview,
  onElementPropertyCommit,
  onNoteElementPropertyCommit,
  handleGraphBatchSharedSetting,
  getMixedValue,
  getMixedValueCanonical,
  getMixedValueBatch,
  getMixedValueGraphs,
  getMixedValueKeysOnly,
  getMixedValueActiveCapable,
  getSelectedKeysData,
  getSelectedGraphsData,
  getSelectedBatchStyleData,
  getSelectedKeyOnlyPositions,
  batchScrollRefFor,
  batchNoteColorButtonRef,
  batchGlowColorButtonRef,
  batchBorderColorButtonRef,
  batchCounterFillButtonRef,
  batchImageButtonRef,
  showBatchImagePicker,
  setShowBatchImagePicker,
  batchPickerFor,
  setBatchPickerFor,
  batchCounterColorState,
  setBatchCounterColorState,
  batchLocalColors,
  setBatchLocalColors,
  handleBatchPickerToggle,
  handleBatchPickerColorChange,
  handleBatchPickerColorChangeComplete,
  handleBatchFillPickerColorChangeComplete,
  getBatchPickerColor,
  getBatchPickerRef,
  batchColorPickerInteractiveRefs,
  panelElement,
  useCustomCSS,
  selectedKeyType,
  t,
}) => {
  // 피커 open 시점의 선택을 ID로 고정 - 대기 중 재정렬·모드 전환에도
  // 완료가 시작 시점 요소들에 적용된다
  // 결합 소유자는 이 패널이다 - EditSessionBoundary 안(탭 컴포넌트)에 두면
  // 같은 개수 선택 교체 시 리마운트로 open 중 재캡처가 일어난다
  const batchImageBinding = useBatchElementBinding(showBatchImagePicker, () =>
    captureBatchElementBinding({
      key: selectedKeyElements,
      stat: selectedStatElements,
      graph: selectedGraphElements,
      knob: selectedKnobElements,
    }),
  );
  const idleTransparencyBinding = captureBatchElementBinding({
    key: selectedKeyElements,
    stat: selectedStatElements,
    graph: selectedGraphElements,
    knob: selectedKnobElements,
  });
  const activeTransparencyBinding = captureBatchElementBinding({
    key: selectedKeyElements,
    knob: selectedKnobElements,
  });

  // open 판정은 activePageKey다. renderPageKey는 exit 애니메이션 동안
  // 유지되는 마운트 상태라, 닫고 250ms 안에 재열면 전환이 감지되지 않아
  // 이전 결합이 재사용된다 (닫히는 동안의 옛 완료는 유지된 bound가 담당)
  const { activePageKey } = usePanelNav();
  const animationBinding = useBatchElementBinding(
    activePageKey === BATCH_COUNTER_ANIMATION_PAGE_KEY,
    () =>
      captureBatchElementBinding({
        key: selectedKeyElements,
        stat: selectedStatElements,
      }),
  );
  const {
    previewStyleProperty,
    commitStyleProperty,
    previewPaint,
    commitPaint,
    commitShadow,
    commitNoteStyleProperty,
    notePaintIds,
    bindNotePaintFailureRestore,
    commitNotePaint,
    previewNotePaint,
    counterFillTargets,
    commitCounterFill,
    commitSoundEnabled,
    commitSoundVolume,
    commitCounterEnabled,
    commitCounterAnimationEnabled,
    commitCounterLayout,
    commitCounterTypography,
    soundBinding,
  } = useBatchKeyLikeCommitRuntime({
    selectedBatchStyleElements,
    selectedKeyElements,
    selectedStatElements,
    selectedKnobElements,
    selectedKeyType,
    batchCounterColorState,
    activePageKey,
  });

  const hasGraphSelection = selectedGraphElements.length > 0;
  // 표시값·Mixed 판정은 resize가 실제로 쓰는 대상 집합(키·스탯·그래프·노브)과 같아야 한다.
  // 노브만 섞여도 키 전용 getter를 쓰면 노브 값이 대표값에 가려진 채 덮인다
  const hasBatchStyleOnlySelection =
    hasGraphSelection || selectedKnobElements.length > 0;
  const styleMixedValueGetter = hasBatchStyleOnlySelection
    ? getMixedValueBatch
    : getMixedValue;
  const styleSelectedDataGetter = hasBatchStyleOnlySelection
    ? getSelectedBatchStyleData
    : getSelectedKeysData;

  const keysData = getSelectedKeysData();
  const keyOnlyPositions = getSelectedKeyOnlyPositions();

  // 배치 노트 페인트 - GradientSpec 집계·편집 (본체·글로우·테두리)
  const openNoteSurface: BatchNoteSurface | null =
    batchPickerFor === 'noteColor'
      ? 'note'
      : batchPickerFor === 'glowColor'
      ? 'glow'
      : batchPickerFor === 'borderColor'
      ? 'border'
      : null;
  const batchNotePositions =
    selectedKeyElements.length > 0
      ? keyOnlyPositions.map(({ position }) => position)
      : keysData
          .map(({ position }) => position)
          .filter((position): position is KeyPosition => position != null);
  // 선택 구성 시그니처 - 형식 왕복 기억·세션 소유가 다른 선택과 교차하지 않게
  const batchNoteSelectionKey = `${selectedKeyType}:${[...notePaintIds]
    .sort()
    .join(',')}`;
  const batchNotePaint = useBatchNotePaint({
    positions: batchNotePositions,
    open: openNoteSurface,
    selectionKey: batchNoteSelectionKey,
    commitNotePaint,
    previewNotePaint,
  });
  // 영구 실패는 canonical 재반영 신호(commitTick)가 오지 않는다. 열린 피커의
  // 로컬 대표값을 canonical에서 다시 읽어 옛 편집값이 다음 커밋에 실리지 않게
  bindNotePaintFailureRestore((patch) => {
    if (editGestureController.activeGestureId() !== null) return;
    const surface: BatchNoteSurface =
      patch.property === 'notePaint'
        ? 'note'
        : patch.property === 'noteGlowPaint'
        ? 'glow'
        : 'border';
    const state = batchNotePaint.states[surface];
    if (state.format === 'gradient') {
      // 스톱 초안만 버리면 저장값 spec이 다시 제시된다
      state.cancelPreview();
      return;
    }
    if (surface === 'border') {
      batchNotePaint.previewBorderSolid(
        hexWithAlphaPercent(
          getMixedValueCanonical((pos) => pos.noteBorderColor, '#FFFFFF').value,
          getMixedValueCanonical((pos) => pos.noteBorderOpacity, 100).value,
        ),
      );
      return;
    }
    const color = getMixedValueCanonical(
      (pos) =>
        surface === 'note' ? pos.noteColor : pos.noteGlowColor ?? pos.noteColor,
      '#FFFFFF' as NoteColor,
    ).value;
    if (typeof color === 'string') state.handlePickerColorChange(color, false);
    if (surface === 'note') {
      batchNotePaint.setNoteOpacity(
        getMixedValueCanonical((pos) => pos.noteOpacity, 80).value,
      );
    } else {
      batchNotePaint.setGlowOpacity(
        getMixedValueCanonical((pos) => pos.noteGlowOpacity, 70).value,
      );
    }
  });
  const getBatchNoteColorDisplay = () => batchNotePaint.displays.note;
  const getBatchGlowColorDisplay = () => batchNotePaint.displays.glow;
  const getBatchBorderColorDisplay = () => batchNotePaint.displays.border;
  const firstCounterPosition =
    keyOnlyPositions[0]?.position ?? keysData[0]?.position;
  const batchCounterSettings = firstCounterPosition
    ? normalizeCounterSettings(firstCounterPosition.counter)
    : createDefaultCounterSettings();
  const selectedCounterSettings = keysData.map(({ position }) =>
    normalizeCounterSettings(position.counter),
  );
  const firstPos = keysData[0]?.position;
  const batchKeyVisual = firstPos
    ? {
        ...firstPos,
        displayName: keysData[0]?.keyInfo?.displayName,
        isStat: selectedKeyLikeElements[0]?.type === 'stat',
      }
    : undefined;
  // NOTE 탭은 키만 편집하므로 Mixed도 키 기준. 통계가 섞인 선택에서 통계 값이 Mixed를 만들지 않게
  const noteMixedFn =
    selectedKeyElements.length > 0 ? getMixedValueKeysOnly : getMixedValue;
  const batchSpacing = getBatchSpacingValue();
  const graphSettings = createBatchGraphSettingsModel(
    getMixedValueGraphs,
    getSelectedGraphsData().map(
      ({ position }) => position as GraphItemPosition,
    ),
  );

  // 배치 카운터 채움은 세션 훅 없는 ColorPicker 직결 경로 - 상태 프리뷰 직접 발행
  useEditStatePreviewPublisher(
    batchPickerFor === 'fill' && selectedKeyElements.length > 0
      ? { kind: 'batch' }
      : null,
    batchCounterColorState,
  );

  const getCounterColorDisplay = (target: 'fill') => {
    const key = batchCounterColorState === 'active' ? 'fillActive' : 'fillIdle';

    if (batchPickerFor === target) {
      return batchLocalColors[key];
    }

    return batchCounterColorState === 'active'
      ? batchCounterSettings.fill.active
      : batchCounterSettings.fill.idle;
  };

  return (
    <div ref={setPanelElement} className={PANEL_ROOT_CLASS}>
      {/* 헤더 + 탭 영역 */}
      <div className="flex-shrink-0">
        <BatchPanelHeader
          totalCount={totalCount ?? selectedBatchStyleElements.length}
          selectedGroupInfo={selectedGroupInfo}
          isRenaming={isRenaming}
          renameInputRef={renameInputRef}
          renameValue={renameValue}
          setRenameValue={setRenameValue}
          renameCancelledRef={renameCancelledRef}
          handleRenameCommit={handleRenameCommit}
          handleRenameCancel={handleRenameCancel}
          handleRenameStart={handleRenameStart}
          t={t}
        />

        {/* 탭 */}
        <div className="px-[12px] pb-[12px]">
          <Tabs
            activeTab={activeTab}
            onTabChange={setActiveTab}
            t={t}
            availableTabs={
              selectedKeyElements.length > 0
                ? [TABS.STYLE, TABS.NOTE, TABS.COUNTER]
                : [TABS.STYLE, TABS.COUNTER]
            }
          />
        </div>
      </div>

      <>
        <div className="flex-1 properties-panel-overlay-scroll">
          {/* STYLE 탭 viewport */}
          <div
            ref={batchScrollRefFor(TABS.STYLE)}
            className={`properties-panel-overlay-viewport ${
              activeTab === TABS.STYLE ? '' : 'hidden'
            }`}
          >
            <EditSessionBoundary>
              <BatchStyleTabContent
                selectedCount={selectedBatchStyleElements.length}
                totalCount={totalCount ?? selectedBatchStyleElements.length}
                soundBinding={soundBinding}
                onSoundPathCommit={(soundPath) =>
                  commitBoundSoundPath(soundBinding.selection, soundPath)
                }
                onSoundEnabledCommit={commitSoundEnabled}
                onSoundVolumeCommit={commitSoundVolume}
                onStylePropertyPreview={previewStyleProperty}
                onStylePropertyCommit={commitStyleProperty}
                onPaintPreview={previewPaint}
                onPaintCommit={commitPaint}
                onFontColorPreview={previewPaint}
                onFontColorCommit={commitPaint}
                onShadowCommit={commitShadow}
                showSoundControls={selectedKeyElements.length > 0}
                showShadowControls={!hasGraphSelection}
                shadowActiveState={
                  selectedKeyElements.length > 0 ||
                  selectedKnobElements.length > 0
                }
                getMixedValue={styleMixedValueGetter}
                getSelectedKeysData={styleSelectedDataGetter}
                afterSizeContent={
                  hasGraphSelection ? (
                    <BatchGraphSettingsSection
                      model={graphSettings}
                      graphIds={selectedGraphElements.map(({ id }) => id)}
                      selectedKeyType={selectedKeyType}
                      colorId={`graph-batch-mixed-color-${selectedKeyType}`}
                      panelElement={panelElement}
                      onCommit={handleGraphBatchSharedSetting}
                      t={t}
                    />
                  ) : undefined
                }
                handleBatchAlign={handleBatchAlign}
                handleBatchDistribute={handleBatchDistribute}
                handleBatchSpacing={handleBatchSpacing}
                handleBatchSpacingPreview={handleBatchSpacingPreview}
                handleBatchSpacingCommit={handleBatchSpacingCommit}
                batchSpacing={batchSpacing}
                handleBatchResize={handleBatchResize}
                handleBatchResizePreview={handleBatchResizePreview}
                onElementPropertyCommit={onElementPropertyCommit}
                getKeyOnlyMixedValue={getMixedValueKeysOnly}
                getActiveCapableMixedValue={getMixedValueActiveCapable}
                showBatchImagePicker={showBatchImagePicker}
                onToggleBatchImagePicker={() =>
                  setShowBatchImagePicker(!showBatchImagePicker)
                }
                batchImageButtonRef={batchImageButtonRef}
                panelElement={panelElement}
                useCustomCSS={useCustomCSS}
                t={t}
              />
            </EditSessionBoundary>
          </div>

          {/* NOTE 탭 viewport */}
          {selectedKeyElements.length > 0 && (
            <div
              ref={batchScrollRefFor(TABS.NOTE)}
              className={`properties-panel-overlay-viewport ${
                activeTab === TABS.NOTE ? '' : 'hidden'
              }`}
            >
              <EditSessionBoundary>
                <BatchNoteTabContent
                  getMixedValue={getMixedValueKeysOnly}
                  onElementPropertyCommit={onNoteElementPropertyCommit}
                  onStylePropertyCommit={commitNoteStyleProperty}
                  getBatchNoteColorDisplay={getBatchNoteColorDisplay}
                  getBatchGlowColorDisplay={getBatchGlowColorDisplay}
                  getBatchBorderColorDisplay={getBatchBorderColorDisplay}
                  onNoteColorPickerToggle={() =>
                    handleBatchPickerToggle('noteColor')
                  }
                  onGlowColorPickerToggle={() =>
                    handleBatchPickerToggle('glowColor')
                  }
                  onBorderColorPickerToggle={() =>
                    handleBatchPickerToggle('borderColor')
                  }
                  isNoteColorPickerOpen={batchPickerFor === 'noteColor'}
                  isGlowColorPickerOpen={batchPickerFor === 'glowColor'}
                  isBorderColorPickerOpen={batchPickerFor === 'borderColor'}
                  batchNoteColorButtonRef={batchNoteColorButtonRef}
                  batchGlowColorButtonRef={batchGlowColorButtonRef}
                  batchBorderColorButtonRef={batchBorderColorButtonRef}
                  t={t}
                />
              </EditSessionBoundary>
            </div>
          )}

          {/* COUNTER 탭 viewport */}
          <div
            ref={batchScrollRefFor(TABS.COUNTER)}
            className={`properties-panel-overlay-viewport ${
              activeTab === TABS.COUNTER ? '' : 'hidden'
            }`}
          >
            <EditSessionBoundary>
              <BatchCounterTabContent
                batchCounterSettings={batchCounterSettings}
                selectedCounterSettings={selectedCounterSettings}
                keyVisual={batchKeyVisual}
                onCounterEnabledCommit={commitCounterEnabled}
                onCounterAnimationEnabledCommit={commitCounterAnimationEnabled}
                onCounterLayoutCommit={commitCounterLayout}
                onCounterTypographyCommit={commitCounterTypography}
                colorState={batchCounterColorState}
                getCounterColorDisplay={getCounterColorDisplay}
                onFillPickerToggle={() => handleBatchPickerToggle('fill')}
                batchCounterFillButtonRef={batchCounterFillButtonRef}
                isFillPickerOpen={batchPickerFor === 'fill'}
                animationBinding={animationBinding}
                t={t}
              />
            </EditSessionBoundary>
          </div>
        </div>

        <BatchColorPickerPopup
          batchPickerFor={batchPickerFor}
          setBatchPickerFor={setBatchPickerFor}
          openNoteSurface={openNoteSurface}
          batchNotePaint={batchNotePaint}
          batchCounterSettings={batchCounterSettings}
          batchCounterColorState={batchCounterColorState}
          setBatchCounterColorState={setBatchCounterColorState}
          setBatchLocalColors={setBatchLocalColors}
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
          selectedKeyCount={selectedKeyElements.length}
          counterFillTargetCount={counterFillTargets.length}
          commitCounterFill={commitCounterFill}
          previewNotePaint={previewNotePaint}
          commitNotePaint={commitNotePaint}
          noteMixedValueGetter={noteMixedFn}
          getMixedValue={getMixedValue}
          getMixedValueActiveCapable={getMixedValueActiveCapable}
          getMixedValueCanonical={getMixedValueCanonical}
          t={t}
        />

        {/* 다중 선택용 ImagePicker */}
        <BatchImagePickerPopup
          open={showBatchImagePicker}
          referenceRef={batchImageButtonRef}
          panelElement={panelElement}
          publishBatchPreview
          showActiveState={
            selectedKeyElements.length > 0 || selectedKnobElements.length > 0
          }
          idleImage={
            styleMixedValueGetter((pos) => pos.inactiveImage, '').isMixed
              ? ''
              : styleMixedValueGetter((pos) => pos.inactiveImage, '').value
          }
          activeImage={
            getMixedValueActiveCapable((pos) => pos.activeImage, '').isMixed
              ? ''
              : getMixedValueActiveCapable((pos) => pos.activeImage, '').value
          }
          idleTransparent={
            styleMixedValueGetter((pos) => pos.idleTransparent, false).value
          }
          activeTransparent={
            getMixedValueActiveCapable((pos) => pos.activeTransparent, false)
              .value
          }
          completionBinding={batchImageBinding.binding}
          onIdleImageChange={(imageUrl) => {
            commitBoundInactiveImage(batchImageBinding.selection, imageUrl);
          }}
          onActiveImageChange={(imageUrl) => {
            commitBoundActiveImage(batchImageBinding.selection, imageUrl);
          }}
          onIdleTransparentChange={(value) => {
            commitBoundIdleTransparent(
              idleTransparencyBinding.selection,
              value,
            );
          }}
          onActiveTransparentChange={(value) => {
            commitBoundActiveTransparent(
              activeTransparencyBinding.selection,
              value,
            );
          }}
          onIdleImageReset={() => {
            commitBoundInactiveImage(batchImageBinding.selection, '');
          }}
          onActiveImageReset={() => {
            commitBoundActiveImage(batchImageBinding.selection, '');
          }}
          onClose={() => setShowBatchImagePicker(false)}
        />
      </>
    </div>
  );
};

export {
  BatchGraphOnlyPanel,
  BatchKnobOnlyPanel,
  BatchPluginOnlyPanel,
} from './BatchSpecializedPanels';
