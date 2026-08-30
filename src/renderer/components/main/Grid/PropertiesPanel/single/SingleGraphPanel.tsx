import React from 'react';
import type { ImageFit } from '@src/types/key/keys';
import type { StatItemType } from '@src/types/key/statItems';
import type {
  GraphItemPosition,
  GraphItemType,
} from '@src/types/key/graphItems';
import { editGestureController } from '@src/renderer/editor/runtime/editGestureController';
import { isNativeElementId } from '@src/renderer/editor/model/elementId';
import { paintDescriptor } from '@src/types/color';
import {
  DEFAULT_ELEMENT_BG,
  DEFAULT_ELEMENT_RADIUS,
} from '@utils/core/elementDefaults';
import { resolveElementBorder } from '@utils/core/elementBorder';
import { PANEL_ROOT_CLASS } from '../panelChrome';
import {
  PropertyRow,
  NumberInput,
  TextInput,
  ColorInput,
  PropertySection,
  TABS,
  type TabType,
} from '../index';
import Checkbox from '@components/main/common/Checkbox';
import Dropdown from '@components/main/common/Dropdown';
import EditSessionBoundary from '../EditSessionBoundary';
import type { GeometryField } from '@src/renderer/editor/runtime/elementOps';
import type {
  EditorElementPropertyPatchV1,
  EditorPaintPropertyPatchV1,
  EditorPreviewStylePropertyPatchV1,
} from '@src/types/editor';
import { getStatTypeLabel } from '@utils/grid/statTypeLabel';
import SingleGeometrySection from './SingleGeometrySection';
import SingleImagePickerPopup from './SingleImagePickerPopup';
import SinglePanelRenameHeader from './SinglePanelRenameHeader';

// ============================================================================
// Single Graph Selection Panel
// ============================================================================

interface SingleGraphPanelProps {
  setPanelElement: (el: HTMLDivElement | null) => void;
  // 혼합 선택 시 패널 본문 상단에 표시할 플러그인 개수 안내
  singleGraphPosition: GraphItemPosition;
  selectedKeyType: string;
  isRenaming: boolean;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  renameValue: string;
  setRenameValue: (value: string) => void;
  renameCancelledRef: React.MutableRefObject<boolean>;
  handleRenameCommit: (value: string) => void;
  handleRenameCancel: () => void;
  handleRenameStart: () => void;
  onElementPropertyCommit?: (
    patch: EditorElementPropertyPatchV1,
    options?: { gestureId?: string },
  ) => void;
  onGraphColorPreview?: (color: string) => void;
  onInactiveImageCommit?: (inactiveImage: string) => void;
  onIdleTransparentCommit?: (idleTransparent: boolean) => void;
  onIdleImageFitCommit?: (idleImageFit: ImageFit) => void;
  onStylePropertyCommit?: (patch: EditorPreviewStylePropertyPatchV1) => void;
  onPaintPreview?: (patch: EditorPaintPropertyPatchV1) => void;
  onPaintCommit?: (patch: EditorPaintPropertyPatchV1) => void;
  handleGeometryCommit?: (field: GeometryField, value: number) => void;
  handleGeometryPreview?: (field: GeometryField, value: number) => void;
  singleScrollRefFor: (tab: TabType) => (node: HTMLDivElement | null) => void;
  showGraphImagePicker: boolean;
  setShowGraphImagePicker: (value: boolean) => void;
  graphImageButtonRef: React.RefObject<HTMLButtonElement | null>;
  graphClassNameDraft: string;
  setGraphClassNameDraft: (value: string) => void;
  panelElement: HTMLDivElement | null;
  useCustomCSS: boolean;
  t: (key: string) => string | undefined;
}

export const SingleGraphPanel: React.FC<SingleGraphPanelProps> = ({
  setPanelElement,
  singleGraphPosition,
  selectedKeyType,
  isRenaming,
  renameInputRef,
  renameValue,
  setRenameValue,
  renameCancelledRef,
  handleRenameCommit,
  handleRenameCancel,
  handleRenameStart,
  onElementPropertyCommit,
  onGraphColorPreview,
  onInactiveImageCommit,
  onIdleTransparentCommit,
  onIdleImageFitCommit,
  onStylePropertyCommit,
  onPaintPreview,
  onPaintCommit,
  handleGeometryCommit,
  handleGeometryPreview,
  singleScrollRefFor,
  showGraphImagePicker,
  setShowGraphImagePicker,
  graphImageButtonRef,
  graphClassNameDraft,
  setGraphClassNameDraft,
  panelElement,
  useCustomCSS,
  t,
}) => {
  const graphShapeOptions = [
    { label: t('propertiesPanel.graphShapeLine') || 'Line', value: 'line' },
    { label: t('propertiesPanel.graphShapeBar') || 'Bar', value: 'bar' },
  ];

  const resolvedGraphStatType =
    (singleGraphPosition.statType as StatItemType) || 'kps';
  const graphDefaultTitle = `${getStatTypeLabel(resolvedGraphStatType)} Graph`;
  const graphTitle = singleGraphPosition.layerName || graphDefaultTitle;
  // 미지정 테두리는 앱 기본 립을 그대로 보여 준다 (렌더와 같은 해석기)
  const graphBorderDisplay = resolveElementBorder(singleGraphPosition, false);

  return (
    <div ref={setPanelElement} className={PANEL_ROOT_CLASS}>
      <SinglePanelRenameHeader
        title={graphTitle}
        titleClassName="text-fg text-label truncate max-w-[100px] cursor-default"
        renameButtonTitle={
          isRenaming ? '' : t('contextMenu.rename') || 'Rename'
        }
        isRenaming={isRenaming}
        renameInputRef={renameInputRef}
        renameValue={renameValue}
        setRenameValue={setRenameValue}
        renameCancelledRef={renameCancelledRef}
        handleRenameCommit={handleRenameCommit}
        handleRenameCancel={handleRenameCancel}
        handleRenameStart={handleRenameStart}
      />
      <div className="flex-1 properties-panel-overlay-scroll">
        <div
          ref={singleScrollRefFor(TABS.STYLE)}
          className="properties-panel-overlay-viewport"
        >
          <EditSessionBoundary>
            <SingleGeometrySection
              keyPosition={singleGraphPosition}
              kind="graph"
              onGeometryPreview={handleGeometryPreview}
              onGeometryCommit={handleGeometryCommit}
              t={t}
            />

            <PropertySection>
              <PropertyRow
                label={t('propertiesPanel.graphShape') || 'Graph Shape'}
              >
                <Dropdown
                  commitStrategy="after-paint"
                  options={graphShapeOptions}
                  value={singleGraphPosition.graphType || 'line'}
                  onChange={(value) =>
                    onElementPropertyCommit?.({
                      property: 'graphType',
                      value: value as GraphItemType,
                    })
                  }
                />
              </PropertyRow>

              {(singleGraphPosition.graphType || 'line') === 'line' && (
                <div className="flex justify-between items-center w-full min-h-[32px]">
                  <p className="text-fg-muted text-label">
                    {t('propertiesPanel.graphShowAverageLine') ||
                      'Show Average Line'}
                  </p>
                  <Checkbox
                    commitStrategy="after-paint"
                    checked={singleGraphPosition.showAvgLine ?? true}
                    onChange={() =>
                      onElementPropertyCommit?.({
                        property: 'showAvgLine',
                        value: !(singleGraphPosition.showAvgLine ?? true),
                      })
                    }
                  />
                </div>
              )}

              <PropertyRow
                label={t('propertiesPanel.graphSpeed') || 'Graph Speed'}
              >
                <NumberInput
                  value={Math.round(singleGraphPosition.graphSpeed || 1000)}
                  width="62px"
                  onChange={(value) => {
                    const clamped = Math.max(500, Math.min(5000, value));
                    const snapped = Math.round(clamped / 100) * 100;
                    onElementPropertyCommit?.({
                      property: 'graphSpeed',
                      value: snapped,
                    });
                  }}
                  min={500}
                  max={5000}
                  suffix="ms"
                />
              </PropertyRow>

              <PropertyRow
                label={t('propertiesPanel.graphColor') || 'Graph Color'}
              >
                <ColorInput
                  value={singleGraphPosition.graphColor || '#86EFAC'}
                  onChange={() => {}}
                  onPreview={(value) => onGraphColorPreview?.(value)}
                  onChangeComplete={(value) =>
                    onElementPropertyCommit?.({
                      property: 'graphColor',
                      value: value,
                    })
                  }
                  onCancel={() => editGestureController.cancel()}
                  colorId={`graph-color-${selectedKeyType}-${singleGraphPosition.id}`}
                  panelElement={panelElement}
                />
              </PropertyRow>

              <div className="flex justify-between items-center w-full min-h-[32px]">
                <p className="text-fg-muted text-label">
                  {t('propertiesPanel.graphAnimation') || 'Graph Animation'}
                </p>
                <Checkbox
                  commitStrategy="after-paint"
                  checked={singleGraphPosition.graphAnimationEnabled ?? true}
                  onChange={() =>
                    onElementPropertyCommit?.({
                      property: 'graphAnimationEnabled',
                      value: !(
                        singleGraphPosition.graphAnimationEnabled ?? true
                      ),
                    })
                  }
                />
              </div>
            </PropertySection>

            <PropertySection>
              <PropertyRow
                label={
                  t('propertiesPanel.backgroundColor') || 'Background Color'
                }
              >
                <ColorInput
                  value={
                    singleGraphPosition.backgroundColor || DEFAULT_ELEMENT_BG
                  }
                  onChange={() => {}}
                  onChangeComplete={() => {}}
                  gradientValue={singleGraphPosition.backgroundGradient ?? null}
                  canvasAnchor={
                    singleGraphPosition.id &&
                    isNativeElementId(singleGraphPosition.id)
                      ? { kind: 'graph', id: singleGraphPosition.id }
                      : undefined
                  }
                  onModePreview={(_state, modeValue) =>
                    onPaintPreview?.({
                      property: 'backgroundPaint',
                      value: paintDescriptor(modeValue),
                    })
                  }
                  onModeCommit={(_state, modeValue) =>
                    onPaintCommit?.({
                      property: 'backgroundPaint',
                      value: paintDescriptor(modeValue),
                    })
                  }
                  onCancel={() => editGestureController.cancel()}
                  colorId={`graph-bg-color-${selectedKeyType}-${singleGraphPosition.id}`}
                  panelElement={panelElement}
                />
              </PropertyRow>

              <PropertyRow
                label={t('propertiesPanel.borderColor') || 'Border Color'}
              >
                <ColorInput
                  value={graphBorderDisplay.color}
                  onChange={() => {}}
                  onChangeComplete={() => {}}
                  gradientValue={graphBorderDisplay.gradient}
                  canvasAnchor={
                    singleGraphPosition.id &&
                    isNativeElementId(singleGraphPosition.id)
                      ? { kind: 'graph', id: singleGraphPosition.id }
                      : undefined
                  }
                  onModePreview={(_state, modeValue) =>
                    onPaintPreview?.({
                      property: 'borderPaint',
                      value: paintDescriptor(modeValue),
                    })
                  }
                  onModeCommit={(_state, modeValue) =>
                    onPaintCommit?.({
                      property: 'borderPaint',
                      value: paintDescriptor(modeValue),
                    })
                  }
                  onCancel={() => editGestureController.cancel()}
                  colorId={`graph-border-color-${selectedKeyType}-${singleGraphPosition.id}`}
                  gradientSurface="border"
                  panelElement={panelElement}
                />
              </PropertyRow>

              <PropertyRow
                label={t('propertiesPanel.borderWidth') || 'Border Width'}
              >
                <NumberInput
                  value={Math.round(singleGraphPosition.borderWidth ?? 1)}
                  onChange={(value) =>
                    onStylePropertyCommit?.({
                      property: 'borderWidth',
                      value: Math.max(0, Math.min(20, value)),
                    })
                  }
                  min={0}
                  max={20}
                  suffix="px"
                />
              </PropertyRow>

              <PropertyRow
                label={t('propertiesPanel.borderRadius') || 'Border Radius'}
              >
                <NumberInput
                  value={Math.round(
                    singleGraphPosition.borderRadius ?? DEFAULT_ELEMENT_RADIUS,
                  )}
                  onChange={(value) =>
                    onStylePropertyCommit?.({
                      property: 'borderRadius',
                      value: Math.max(0, Math.min(100, value)),
                    })
                  }
                  min={0}
                  max={100}
                  suffix="px"
                />
              </PropertyRow>

              <PropertyRow
                label={t('propertiesPanel.customImage') || 'Custom Image'}
              >
                <button
                  ref={graphImageButtonRef}
                  type="button"
                  className={`px-[8px] h-[23px] bg-fill hover:bg-fill-hover active:bg-fill-active transition-colors duration-fast rounded-md flex items-center justify-center ${
                    showGraphImagePicker ? 'shadow-focus-ring' : ''
                  } text-fg text-body`}
                  onClick={() => setShowGraphImagePicker(!showGraphImagePicker)}
                >
                  {t('propertiesPanel.configure') || 'Configure'}
                </button>
              </PropertyRow>
            </PropertySection>

            {useCustomCSS && (
              <PropertySection>
                <div className="flex justify-between items-center w-full min-h-[32px]">
                  <p className="text-fg-muted text-label">
                    {t('propertiesPanel.useInlineStyles') ||
                      '인라인 스타일 우선'}
                  </p>
                  <Checkbox
                    commitStrategy="after-paint"
                    checked={singleGraphPosition.useInlineStyles ?? false}
                    onChange={() =>
                      onElementPropertyCommit?.({
                        property: 'useInlineStyles',
                        value: !(singleGraphPosition.useInlineStyles ?? false),
                      })
                    }
                  />
                </div>

                <PropertyRow label={t('propertiesPanel.className') || '클래스'}>
                  <TextInput
                    value={graphClassNameDraft}
                    onChange={setGraphClassNameDraft}
                    onBlur={(value) =>
                      onStylePropertyCommit?.({
                        property: 'className',
                        value: value,
                      })
                    }
                    placeholder="className"
                    width="90px"
                  />
                </PropertyRow>
              </PropertySection>
            )}
          </EditSessionBoundary>
        </div>
      </div>

      <SingleImagePickerPopup
        open={showGraphImagePicker}
        keyPosition={singleGraphPosition}
        imageButtonRef={graphImageButtonRef}
        panelElement={panelElement}
        showActiveState={false}
        showTransformControls={false}
        bindActiveState={false}
        fallbackEmptyImageFit
        requireMountedReference
        onToggle={() => setShowGraphImagePicker(false)}
        onInactiveImageCommit={onInactiveImageCommit}
        onIdleTransparentCommit={onIdleTransparentCommit}
        onIdleImageFitCommit={onIdleImageFitCommit}
      />
    </div>
  );
};
