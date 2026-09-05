import React from 'react';
import type { KeyPosition } from '@src/types/key/keys';
import type { KnobItemPosition } from '@src/types/key/knobs';
import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import { PANEL_ROOT_CLASS } from '../panelChrome';
import {
  PropertyRow,
  NumberInput,
  BatchStyleTabContent,
  TABS,
  type TabType,
} from '../index';
import Checkbox from '@components/main/common/Checkbox';
import EditSessionBoundary from '../EditSessionBoundary';
import {
  captureBatchElementBinding,
  useBatchElementBinding,
} from '@hooks/pickers/useBatchElementBinding';
import type { BatchElementPropertyUpdate } from '../types';
import BatchPanelHeader from './BatchPanelHeader';
import BatchImagePickerPopup from './BatchImagePickerPopup';
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

const BatchKnobOnlyPanel: React.FC<BatchKnobOnlyPanelProps> = ({
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

      <BatchImagePickerPopup
        open={showBatchImagePicker}
        referenceRef={batchImageButtonRef}
        panelElement={panelElement}
        publishBatchPreview
        showActiveState
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
        onIdleImageChange={(imageUrl) => {
          commitBoundInactiveImage(knobImageBinding.selection, imageUrl);
        }}
        onActiveImageChange={(imageUrl) => {
          commitBoundActiveImage(knobImageBinding.selection, imageUrl);
        }}
        onIdleTransparentChange={(value) => {
          commitBoundIdleTransparent(knobTransparencyBinding.selection, value);
        }}
        onActiveTransparentChange={(value) => {
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
    </div>
  );
};

export default BatchKnobOnlyPanel;
