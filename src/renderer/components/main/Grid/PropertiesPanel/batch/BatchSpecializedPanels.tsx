/* eslint-disable react-hooks/refs */
import React from 'react';
import type { KeyPosition } from '@src/types/key/keys';
import type { GraphItemPosition } from '@src/types/key/graphItems';
import type { KnobItemPosition } from '@src/types/key/knobs';
import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import { PANEL_ROOT_CLASS } from '../panelChrome';
import {
  PropertyRow,
  PropertySection,
  NumberInput,
  BatchStyleTabContent,
  TABS,
  type TabType,
} from '../index';
import BatchGeometrySection from './BatchGeometrySection';
import Checkbox from '@components/main/common/Checkbox';
import PopupExit from '@components/main/Modal/PopupExit';
import ImagePicker from '@components/main/Modal/content/pickers/ImagePicker';
import EditSessionBoundary from '../EditSessionBoundary';
import {
  captureBatchElementBinding,
  useBatchElementBinding,
} from '@hooks/pickers/useBatchElementBinding';
import type { BatchElementPropertyUpdate } from '../types';
import BatchPanelHeader from './BatchPanelHeader';
import BatchGraphSettingsSection from './BatchGraphSettingsSection';
import { createBatchGraphSettingsModel } from './batchGraphSettingsModel';
import {
  commitBoundActiveImage,
  commitBoundActiveTransparent,
  commitBoundIdleTransparent,
  commitBoundInactiveImage,
  createPaintHandlers,
  createShadowCommitHandler,
  createStylePropertyHandlers,
  type KeyData,
  type MixedValueGetter,
  type MixedValueResult,
} from './batchPanelShared';

// ============================================================================
// Graph-only batch selection panel
// ============================================================================

interface BatchGraphOnlyPanelProps {
  setPanelElement: (el: HTMLDivElement | null) => void;
  // native+plugin 합산 개수 - 헤더 표시·분배 게이트 (미전달 시 native 개수)
  totalCount?: number;
  selectedGraphElements: SelectedElement[];
  selectedGroupInfo: { id: string; name: string; memberCount: number } | null;
  isRenaming: boolean;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  renameValue: string;
  setRenameValue: (value: string) => void;
  renameCancelledRef: React.MutableRefObject<boolean>;
  handleRenameCommit: (value: string) => void;
  handleRenameCancel: () => void;
  handleRenameStart: () => void;
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
  handleGraphBatchSharedSetting: (updates: Partial<GraphItemPosition>) => void;
  getMixedValueGraphs: MixedValueGetter<GraphItemPosition>;
  getMixedValueGraphsAsKey: MixedValueGetter<KeyPosition>;
  getSelectedGraphsData: () => KeyData[];
  batchScrollRefFor: (tab: TabType) => (node: HTMLDivElement | null) => void;
  batchImageButtonRef: React.RefObject<HTMLButtonElement | null>;
  showBatchImagePicker: boolean;
  setShowBatchImagePicker: (value: boolean) => void;
  panelElement: HTMLDivElement | null;
  useCustomCSS: boolean;
  selectedKeyType: string;
  t: (key: string) => string | undefined;
}

export const BatchGraphOnlyPanel: React.FC<BatchGraphOnlyPanelProps> = ({
  setPanelElement,
  totalCount,
  selectedGraphElements,
  selectedGroupInfo,
  isRenaming,
  renameInputRef,
  renameValue,
  setRenameValue,
  renameCancelledRef,
  handleRenameCommit,
  handleRenameCancel,
  handleRenameStart,
  handleBatchAlign,
  handleBatchDistribute,
  handleBatchSpacing,
  handleBatchSpacingPreview,
  handleBatchSpacingCommit,
  getBatchSpacingValue,
  handleBatchResize,
  handleBatchResizePreview,
  onElementPropertyCommit,
  handleGraphBatchSharedSetting,
  getMixedValueGraphs,
  getMixedValueGraphsAsKey,
  getSelectedGraphsData,
  batchScrollRefFor,
  batchImageButtonRef,
  showBatchImagePicker,
  setShowBatchImagePicker,
  panelElement,
  useCustomCSS,
  selectedKeyType,
  t,
}) => {
  // 이미지 피커 open 시점의 그래프 선택을 ID로 고정
  const graphImageBinding = useBatchElementBinding(showBatchImagePicker, () =>
    captureBatchElementBinding({ graph: selectedGraphElements }),
  );
  const graphTransparencyBinding = captureBatchElementBinding({
    graph: selectedGraphElements,
  });
  const { previewStyleProperty, commitStyleProperty } =
    createStylePropertyHandlers(
      selectedGraphElements.map(({ id }) => ({
        elementType: 'graph',
        id,
      })),
      selectedKeyType,
    );
  const { previewPaint, commitPaint } = createPaintHandlers(
    selectedGraphElements.map(({ id }) => ({
      elementType: 'graph',
      id,
    })),
    selectedKeyType,
  );

  const graphSettings = createBatchGraphSettingsModel(
    getMixedValueGraphs,
    getSelectedGraphsData().map(
      ({ position }) => position as GraphItemPosition,
    ),
  );
  const batchGraphSpacing = getBatchSpacingValue();

  return (
    <div ref={setPanelElement} className={PANEL_ROOT_CLASS}>
      <div className="flex-shrink-0">
        <BatchPanelHeader
          totalCount={totalCount ?? selectedGraphElements.length}
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
      </div>

      <div className="flex-1 properties-panel-overlay-scroll">
        <div
          ref={batchScrollRefFor(TABS.STYLE)}
          className="properties-panel-overlay-viewport"
        >
          <EditSessionBoundary>
            <BatchStyleTabContent
              // 그래프 렌더는 이미지가 있어도 기본 립을 억제하지 않는다 - 패널도 같은 판정
              imageSuppressesDefaultBorder={false}
              selectedCount={selectedGraphElements.length}
              totalCount={totalCount ?? selectedGraphElements.length}
              onStylePropertyPreview={previewStyleProperty}
              onStylePropertyCommit={commitStyleProperty}
              onPaintPreview={previewPaint}
              onPaintCommit={commitPaint}
              hideDisplayText
              hideFontControls
              showSoundControls={false}
              showShadowControls={false}
              shadowActiveState={false}
              afterSizeContent={
                <BatchGraphSettingsSection
                  model={graphSettings}
                  graphIds={selectedGraphElements.map(({ id }) => id)}
                  selectedKeyType={selectedKeyType}
                  colorId={`graph-batch-color-${selectedKeyType}`}
                  panelElement={panelElement}
                  onCommit={handleGraphBatchSharedSetting}
                  t={t}
                />
              }
              getMixedValue={getMixedValueGraphsAsKey}
              getSelectedKeysData={getSelectedGraphsData}
              handleBatchAlign={handleBatchAlign}
              handleBatchDistribute={handleBatchDistribute}
              handleBatchSpacing={handleBatchSpacing}
              handleBatchSpacingPreview={handleBatchSpacingPreview}
              handleBatchSpacingCommit={handleBatchSpacingCommit}
              batchSpacing={batchGraphSpacing}
              handleBatchResize={handleBatchResize}
              handleBatchResizePreview={handleBatchResizePreview}
              onElementPropertyCommit={onElementPropertyCommit}
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
      </div>

      <PopupExit open={showBatchImagePicker}>
        {showBatchImagePicker && batchImageButtonRef.current ? (
          <ImagePicker
            open={showBatchImagePicker}
            referenceRef={batchImageButtonRef}
            panelElement={panelElement}
            showActiveState={false}
            idleImage={
              getMixedValueGraphs((pos) => pos.inactiveImage, '').isMixed
                ? ''
                : getMixedValueGraphs((pos) => pos.inactiveImage, '').value
            }
            activeImage={
              getMixedValueGraphs((pos) => pos.activeImage, '').isMixed
                ? ''
                : getMixedValueGraphs((pos) => pos.activeImage, '').value
            }
            idleTransparent={
              getMixedValueGraphs((pos) => pos.idleTransparent, false).value
            }
            activeTransparent={
              getMixedValueGraphs((pos) => pos.activeTransparent, false).value
            }
            completionBinding={graphImageBinding.binding}
            onIdleImageChange={(imageUrl: string) => {
              commitBoundInactiveImage(graphImageBinding.selection, imageUrl);
            }}
            onIdleTransparentChange={(value: boolean) => {
              commitBoundIdleTransparent(
                graphTransparencyBinding.selection,
                value,
              );
            }}
            onIdleImageReset={() => {
              commitBoundInactiveImage(graphImageBinding.selection, '');
            }}
            onClose={() => setShowBatchImagePicker(false)}
          />
        ) : null}
      </PopupExit>
    </div>
  );
};

// ============================================================================
// Knob-only batch selection panel
// ============================================================================

interface BatchKnobOnlyPanelProps {
  setPanelElement: (el: HTMLDivElement | null) => void;
  // native+plugin 합산 개수 - 헤더 표시·분배 게이트 (미전달 시 native 개수)
  totalCount?: number;
  selectedKnobElements: SelectedElement[];
  selectedGroupInfo: { id: string; name: string; memberCount: number } | null;
  isRenaming: boolean;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  renameValue: string;
  setRenameValue: (value: string) => void;
  renameCancelledRef: React.MutableRefObject<boolean>;
  handleRenameCommit: (value: string) => void;
  handleRenameCancel: () => void;
  handleRenameStart: () => void;
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
  handleKnobBatchSharedSetting: (updates: Partial<KnobItemPosition>) => void;
  getMixedValueKnobs: MixedValueGetter<KnobItemPosition>;
  getMixedValueKnobsAsKey: MixedValueGetter<KeyPosition>;
  getSelectedKnobsData: () => KeyData[];
  batchScrollRefFor: (tab: TabType) => (node: HTMLDivElement | null) => void;
  batchImageButtonRef: React.RefObject<HTMLButtonElement | null>;
  showBatchImagePicker: boolean;
  setShowBatchImagePicker: (value: boolean) => void;
  panelElement: HTMLDivElement | null;
  useCustomCSS: boolean;
  selectedKeyType: string;
  t: (key: string) => string | undefined;
}

export const BatchKnobOnlyPanel: React.FC<BatchKnobOnlyPanelProps> = ({
  setPanelElement,
  totalCount,
  selectedKnobElements,
  selectedGroupInfo,
  isRenaming,
  renameInputRef,
  renameValue,
  setRenameValue,
  renameCancelledRef,
  handleRenameCommit,
  handleRenameCancel,
  handleRenameStart,
  handleBatchAlign,
  handleBatchDistribute,
  handleBatchSpacing,
  handleBatchSpacingPreview,
  handleBatchSpacingCommit,
  getBatchSpacingValue,
  handleBatchResize,
  handleBatchResizePreview,
  onElementPropertyCommit,
  handleKnobBatchSharedSetting,
  getMixedValueKnobs,
  getMixedValueKnobsAsKey,
  getSelectedKnobsData,
  batchScrollRefFor,
  batchImageButtonRef,
  showBatchImagePicker,
  setShowBatchImagePicker,
  panelElement,
  useCustomCSS,
  selectedKeyType,
  t,
}) => {
  // 이미지 피커 open 시점의 노브 선택을 ID로 고정
  const knobImageBinding = useBatchElementBinding(showBatchImagePicker, () =>
    captureBatchElementBinding({ knob: selectedKnobElements }),
  );
  const knobTransparencyBinding = captureBatchElementBinding({
    knob: selectedKnobElements,
  });
  const { previewStyleProperty, commitStyleProperty } =
    createStylePropertyHandlers(
      selectedKnobElements.map(({ id }) => ({
        elementType: 'knob',
        id,
      })),
      selectedKeyType,
    );
  const { previewPaint, commitPaint } = createPaintHandlers(
    selectedKnobElements.map(({ id }) => ({
      elementType: 'knob',
      id,
    })),
    selectedKeyType,
  );
  const commitShadow = createShadowCommitHandler(
    selectedKnobElements.map(({ id }) => ({
      elementType: 'knob',
      id,
    })),
  );

  const sensitivityState = getMixedValueKnobs(
    (pos) => Number(pos.sensitivity ?? 1),
    1,
  );
  const reverseState = getMixedValueKnobs((pos) => pos.reverse ?? false, false);
  const batchKnobSpacing = getBatchSpacingValue();

  return (
    <div ref={setPanelElement} className={PANEL_ROOT_CLASS}>
      <div className="flex-shrink-0">
        <BatchPanelHeader
          totalCount={totalCount ?? selectedKnobElements.length}
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
      </div>

      <div className="flex-1 properties-panel-overlay-scroll">
        <div
          ref={batchScrollRefFor(TABS.STYLE)}
          className="properties-panel-overlay-viewport"
        >
          <EditSessionBoundary>
            <BatchStyleTabContent
              // 노브 렌더는 이미지가 있어도 기본 립을 억제하지 않는다 - 패널도 같은 판정
              imageSuppressesDefaultBorder={false}
              selectedCount={selectedKnobElements.length}
              totalCount={totalCount ?? selectedKnobElements.length}
              onStylePropertyPreview={previewStyleProperty}
              onStylePropertyCommit={commitStyleProperty}
              onPaintPreview={previewPaint}
              onPaintCommit={commitPaint}
              onShadowCommit={commitShadow}
              hideDisplayText
              hideFontControls
              showSoundControls={false}
              shadowKind="knob"
              afterSizeContent={
                <>
                  <PropertyRow
                    label={t('propertiesPanel.knobSensitivity') || '민감도'}
                  >
                    {sensitivityState.isMixed ? (
                      <span className="text-fg-faint text-body italic">
                        Mixed
                      </span>
                    ) : null}
                    <NumberInput
                      value={sensitivityState.value}
                      onChange={(value) =>
                        handleKnobBatchSharedSetting({
                          sensitivity: Math.max(0, value),
                        })
                      }
                      suffix="×"
                      min={0}
                      max={100}
                      allowDecimal
                      decimalScale={2}
                      isMixed={sensitivityState.isMixed}
                    />
                  </PropertyRow>

                  <div className="flex justify-between items-center w-full min-h-[32px]">
                    <p className="text-fg-muted text-label">
                      {t('propertiesPanel.knobReverse') || '방향 반전'}
                    </p>
                    <div className="flex items-center gap-[6px]">
                      {reverseState.isMixed ? (
                        <span className="text-fg-faint text-body italic">
                          Mixed
                        </span>
                      ) : null}
                      <Checkbox
                        commitStrategy="after-paint"
                        checked={reverseState.value}
                        onChange={() =>
                          handleKnobBatchSharedSetting({
                            reverse: !reverseState.value,
                          })
                        }
                      />
                    </div>
                  </div>
                </>
              }
              getMixedValue={getMixedValueKnobsAsKey}
              getSelectedKeysData={getSelectedKnobsData}
              handleBatchAlign={handleBatchAlign}
              handleBatchDistribute={handleBatchDistribute}
              handleBatchSpacing={handleBatchSpacing}
              handleBatchSpacingPreview={handleBatchSpacingPreview}
              handleBatchSpacingCommit={handleBatchSpacingCommit}
              batchSpacing={batchKnobSpacing}
              handleBatchResize={handleBatchResize}
              handleBatchResizePreview={handleBatchResizePreview}
              onElementPropertyCommit={onElementPropertyCommit}
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
      </div>

      <PopupExit open={showBatchImagePicker}>
        {showBatchImagePicker && batchImageButtonRef.current ? (
          <ImagePicker
            open={showBatchImagePicker}
            previewAnchor={{ kind: 'batch' }}
            referenceRef={batchImageButtonRef}
            panelElement={panelElement}
            idleImage={
              getMixedValueKnobs((pos) => pos.inactiveImage, '').isMixed
                ? ''
                : getMixedValueKnobs((pos) => pos.inactiveImage, '').value
            }
            activeImage={
              getMixedValueKnobs((pos) => pos.activeImage, '').isMixed
                ? ''
                : getMixedValueKnobs((pos) => pos.activeImage, '').value
            }
            idleTransparent={
              getMixedValueKnobs((pos) => pos.idleTransparent, false).value
            }
            activeTransparent={
              getMixedValueKnobs((pos) => pos.activeTransparent, false).value
            }
            completionBinding={knobImageBinding.binding}
            onIdleImageChange={(imageUrl: string) => {
              commitBoundInactiveImage(knobImageBinding.selection, imageUrl);
            }}
            onActiveImageChange={(imageUrl: string) => {
              commitBoundActiveImage(knobImageBinding.selection, imageUrl);
            }}
            onIdleTransparentChange={(value: boolean) => {
              commitBoundIdleTransparent(
                knobTransparencyBinding.selection,
                value,
              );
            }}
            onActiveTransparentChange={(value: boolean) => {
              commitBoundActiveTransparent(
                knobTransparencyBinding.selection,
                value,
              );
            }}
            onIdleImageReset={() => {
              commitBoundInactiveImage(knobImageBinding.selection, '');
            }}
            onActiveImageReset={() => {
              commitBoundActiveImage(knobImageBinding.selection, '');
            }}
            onClose={() => setShowBatchImagePicker(false)}
          />
        ) : null}
      </PopupExit>
    </div>
  );
};

// ============================================================================
// Plugin-only batch selection panel (lightweight geometry)
// ============================================================================

interface BatchPluginOnlyPanelProps {
  setPanelElement: (el: HTMLDivElement | null) => void;
  // 플러그인 단독 다중 선택 개수
  totalCount: number;
  selectedGroupInfo: { id: string; name: string; memberCount: number } | null;
  isRenaming: boolean;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  renameValue: string;
  setRenameValue: (value: string) => void;
  renameCancelledRef: React.MutableRefObject<boolean>;
  handleRenameCommit: (value: string) => void;
  handleRenameCancel: () => void;
  handleRenameStart: () => void;
  handleBatchAlign: (
    direction: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom',
  ) => void;
  handleBatchDistribute: (direction: 'horizontal' | 'vertical') => void;
  handleBatchSpacing: (
    spacing: number,
    options?: { gestureId?: string; deferSave?: boolean },
  ) => void;
  handleBatchSpacingCommit: (
    spacing: number,
    options?: { gestureId?: string; deferSave?: boolean },
  ) => void;
  getBatchSpacingValue: () => MixedValueResult<number>;
  batchScrollRefFor: (tab: TabType) => (node: HTMLDivElement | null) => void;
  t: (key: string) => string | undefined;
}

// 플러그인 크기는 content-driven이라 resize 없이 정렬·분배·간격만 노출.
// 스타일 필드는 플러그인 스키마 소유라 배치 편집 대상이 아니다
export const BatchPluginOnlyPanel: React.FC<BatchPluginOnlyPanelProps> = ({
  setPanelElement,
  totalCount,
  selectedGroupInfo,
  isRenaming,
  renameInputRef,
  renameValue,
  setRenameValue,
  renameCancelledRef,
  handleRenameCommit,
  handleRenameCancel,
  handleRenameStart,
  handleBatchAlign,
  handleBatchDistribute,
  handleBatchSpacing,
  handleBatchSpacingCommit,
  getBatchSpacingValue,
  batchScrollRefFor,
  t,
}) => {
  const batchPluginSpacing = getBatchSpacingValue();

  return (
    <div ref={setPanelElement} className={PANEL_ROOT_CLASS}>
      <div className="flex-shrink-0">
        <BatchPanelHeader
          totalCount={totalCount}
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
      </div>

      <div className="flex-1 properties-panel-overlay-scroll">
        <div
          ref={batchScrollRefFor(TABS.STYLE)}
          className="properties-panel-overlay-viewport"
        >
          <EditSessionBoundary>
            <PropertySection>
              <BatchGeometrySection
                totalCount={totalCount}
                handleBatchAlign={handleBatchAlign}
                handleBatchDistribute={handleBatchDistribute}
                handleBatchSpacing={handleBatchSpacing}
                handleBatchSpacingCommit={handleBatchSpacingCommit}
                batchSpacing={batchPluginSpacing}
                t={t}
              />
            </PropertySection>
          </EditSessionBoundary>
        </div>
      </div>
    </div>
  );
};
