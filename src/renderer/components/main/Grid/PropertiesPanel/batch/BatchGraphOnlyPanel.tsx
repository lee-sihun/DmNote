import React from 'react';
import type { KeyPosition } from '@src/types/key/keys';
import type { GraphItemPosition } from '@src/types/key/graphItems';
import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import { PANEL_ROOT_CLASS } from '../panelChrome';
import { BatchStyleTabContent, TABS, type TabType } from '../index';
import EditSessionBoundary from '../EditSessionBoundary';
import {
  captureBatchElementBinding,
  useBatchElementBinding,
} from '@hooks/pickers/useBatchElementBinding';
import type { BatchElementPropertyUpdate } from '../types';
import BatchPanelHeader from './BatchPanelHeader';
import BatchImagePickerPopup from './BatchImagePickerPopup';
import BatchGraphSettingsSection from './BatchGraphSettingsSection';
import { createBatchGraphSettingsModel } from './batchGraphSettingsModel';
import {
  commitBoundIdleTransparent,
  commitBoundInactiveImage,
  createPaintHandlers,
  createStylePropertyHandlers,
  type KeyData,
  type MixedValueGetter,
  type MixedValueResult,
} from './batchPanelShared';

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

const BatchGraphOnlyPanel: React.FC<BatchGraphOnlyPanelProps> = ({
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

      <BatchImagePickerPopup
        open={showBatchImagePicker}
        referenceRef={batchImageButtonRef}
        panelElement={panelElement}
        publishBatchPreview={false}
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
        onIdleImageChange={(imageUrl) => {
          commitBoundInactiveImage(graphImageBinding.selection, imageUrl);
        }}
        onIdleTransparentChange={(value) => {
          commitBoundIdleTransparent(graphTransparencyBinding.selection, value);
        }}
        onIdleImageReset={() => {
          commitBoundInactiveImage(graphImageBinding.selection, '');
        }}
        onClose={() => setShowBatchImagePicker(false)}
      />
    </div>
  );
};

export default BatchGraphOnlyPanel;
