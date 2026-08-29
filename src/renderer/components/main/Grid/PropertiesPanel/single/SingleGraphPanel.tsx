/* eslint-disable react-hooks/refs */
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
import { PANEL_ROOT_CLASS, PANEL_HEADER_CLASS } from '../panelChrome';
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
import PopupExit from '@components/main/Modal/PopupExit';
import ImagePicker from '@components/main/Modal/content/pickers/ImagePicker';
import { AXIS_FIELD_WIDTH } from '@utils/cardRecipes';
import EditSessionBoundary from '../EditSessionBoundary';
import type { GeometryField } from '@src/renderer/editor/runtime/elementOps';
import type {
  EditorElementPropertyPatchV1,
  EditorPaintPropertyPatchV1,
  EditorPreviewStylePropertyPatchV1,
} from '@src/types/editor';
import RenameIcon from './RenameIcon';
import { getStatTypeLabel } from './singlePanelModel';

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
      <div className={PANEL_HEADER_CLASS}>
        {isRenaming ? (
          <input
            ref={renameInputRef}
            type="text"
            className="text-fg text-label leading-none bg-transparent border-none p-0 outline-none w-[130px] caret-accent"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={() => {
              if (!renameCancelledRef.current) {
                handleRenameCommit(renameValue);
              }
              renameCancelledRef.current = false;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                handleRenameCancel();
              }
            }}
          />
        ) : (
          <div className="flex items-center gap-[4px] min-w-0">
            <span
              className="text-fg text-label truncate max-w-[100px] cursor-default"
              onDoubleClick={handleRenameStart}
              title={graphTitle}
            >
              {graphTitle}
            </span>
            <button
              onClick={handleRenameStart}
              className="w-[18px] h-[18px] flex items-center justify-center text-fg-faint hover:text-fg transition-colors flex-shrink-0"
              title={t('contextMenu.rename') || 'Rename'}
            >
              <RenameIcon />
            </button>
          </div>
        )}
      </div>
      <div className="flex-1 properties-panel-overlay-scroll">
        <div
          ref={singleScrollRefFor(TABS.STYLE)}
          className="properties-panel-overlay-viewport"
        >
          <EditSessionBoundary>
            <PropertySection>
              <PropertyRow label={t('propertiesPanel.position') || 'Position'}>
                <NumberInput
                  value={singleGraphPosition.dx || 0}
                  onChange={(value) => {
                    handleGeometryCommit?.('dx', value);
                  }}
                  onPreview={(value) => handleGeometryPreview?.('dx', value)}
                  onCancel={() => editGestureController.cancel()}
                  prefix="X"
                  width={AXIS_FIELD_WIDTH}
                  min={-9999}
                  max={9999}
                  allowDecimal
                  decimalScale={1}
                />
                <NumberInput
                  value={singleGraphPosition.dy || 0}
                  onChange={(value) => {
                    handleGeometryCommit?.('dy', value);
                  }}
                  onPreview={(value) => handleGeometryPreview?.('dy', value)}
                  onCancel={() => editGestureController.cancel()}
                  prefix="Y"
                  width={AXIS_FIELD_WIDTH}
                  min={-9999}
                  max={9999}
                  allowDecimal
                  decimalScale={1}
                />
              </PropertyRow>

              <PropertyRow label={t('propertiesPanel.size') || 'Size'}>
                <NumberInput
                  value={Math.round(singleGraphPosition.width || 200)}
                  onChange={(value) => {
                    handleGeometryCommit?.('width', Math.max(20, value));
                  }}
                  onPreview={(value) =>
                    handleGeometryPreview?.('width', Math.max(20, value))
                  }
                  onCancel={() => editGestureController.cancel()}
                  prefix="W"
                  width={AXIS_FIELD_WIDTH}
                  min={20}
                  max={9999}
                />
                <NumberInput
                  value={Math.round(singleGraphPosition.height || 100)}
                  onChange={(value) => {
                    handleGeometryCommit?.('height', Math.max(20, value));
                  }}
                  onPreview={(value) =>
                    handleGeometryPreview?.('height', Math.max(20, value))
                  }
                  onCancel={() => editGestureController.cancel()}
                  prefix="H"
                  width={AXIS_FIELD_WIDTH}
                  min={20}
                  max={9999}
                />
              </PropertyRow>
            </PropertySection>

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

      <PopupExit open={showGraphImagePicker}>
        {showGraphImagePicker && graphImageButtonRef.current ? (
          <ImagePicker
            open={showGraphImagePicker}
            referenceRef={graphImageButtonRef}
            panelElement={panelElement}
            showActiveState={false}
            completionBinding="element-id"
            idleImage={singleGraphPosition.inactiveImage || ''}
            activeImage={singleGraphPosition.activeImage || ''}
            idleTransparent={singleGraphPosition.idleTransparent ?? false}
            activeTransparent={false}
            idleImageFit={
              singleGraphPosition.idleImageFit ||
              singleGraphPosition.imageFit ||
              'cover'
            }
            activeImageFit={
              singleGraphPosition.activeImageFit ||
              singleGraphPosition.imageFit ||
              'cover'
            }
            onIdleImageChange={(imageUrl: string) =>
              onInactiveImageCommit?.(imageUrl)
            }
            onIdleTransparentChange={(value: boolean) =>
              onIdleTransparentCommit?.(value)
            }
            onIdleImageFitChange={(fit: string) =>
              onIdleImageFitCommit?.(fit as ImageFit)
            }
            onIdleImageReset={() => onInactiveImageCommit?.('')}
            onClose={() => setShowGraphImagePicker(false)}
          />
        ) : null}
      </PopupExit>
    </div>
  );
};
