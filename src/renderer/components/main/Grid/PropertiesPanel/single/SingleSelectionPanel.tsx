/* eslint-disable react-hooks/refs */
import React, { useEffect, useRef, useState } from 'react';
import { patchKnobAxisIdById } from '@src/renderer/editor/runtime/elementOps';
import { reportElementOpError } from '@src/renderer/editor/runtime/elementIntent';
import { isNativeElementId } from '@src/renderer/editor/model/elementId';
import { patchNativeLayerPropertyViaAuthority } from '@plugins/rpc/pluginElementActions';
import { flushPluginInstancesEditSession } from '@plugins/runtime/displayElement/instancesCommitQueue';
import type { ImageFit, KeyPosition, KeySlot } from '@src/types/key/keys';
import {
  STAT_BASE_OPTIONS,
  STAT_KPS_OPTIONS,
  type StatItemPosition,
  type StatItemType,
} from '@src/types/key/statItems';
import type {
  GraphItemPosition,
  GraphItemType,
} from '@src/types/key/graphItems';
import type { KnobItemPosition } from '@src/types/key/knobs';
import type {
  CounterTabContentProps,
  NoteTabContentProps,
  StyleTabContentProps,
} from '../types';
import {
  paintDescriptor,
  gradientToCss,
  type ColorModeValue,
  type GradientSpec,
} from '@src/types/color';
import { useGradientColorState } from '@hooks/pickers/useGradientColorState';
import { axisEventBus } from '@utils/core/axisEventBus';
import {
  DEFAULT_ELEMENT_BG,
  DEFAULT_ELEMENT_ACTIVE_BG,
  DEFAULT_ELEMENT_FONT,
  DEFAULT_ELEMENT_ACTIVE_FONT,
  DEFAULT_ELEMENT_HAIRLINE,
  DEFAULT_ELEMENT_RADIUS,
  DEFAULT_ELEMENT_SHADOW_SPEC,
  DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
} from '@utils/core/elementDefaults';
import {
  elementShadowLeafFromPartial,
  resolveElementShadowForPosition,
} from '@src/types/key/shadows';
import type {
  PluginSettingSchema,
  PluginMessages,
  PluginDefinitionInternal,
  PluginPanelElementView,
} from '@src/types/plugin/api';
import type { KeyInfo } from '@utils/core/KeyMaps';
import { PANEL_ROOT_CLASS, PANEL_HEADER_CLASS } from '../panelChrome';
import {
  hasRenderableSettings,
  type SettingsNormalizationErrorKind,
} from '@plugins/runtime/settingsSections';
import {
  PropertyRow,
  NumberInput,
  TextInput,
  ColorInput,
  PropertySection,
  Tabs,
  StyleTabContent,
  NoteTabContent,
  CounterTabContent,
  TABS,
  TabType,
} from '../index';
import Checkbox from '@components/main/common/Checkbox';
import Dropdown from '@components/main/common/Dropdown';
import ColorPicker from '@components/main/Modal/content/pickers/ColorPicker';
import PopupExit from '@components/main/Modal/PopupExit';
import ImagePicker from '@components/main/Modal/content/pickers/ImagePicker';
import { ColorSwatchButton } from '@components/main/Modal/content/pickers/ColorSwatch';
import ShadowControls from '../ShadowControls';
import { AXIS_FIELD_WIDTH } from '@utils/cardRecipes';
import EditSessionBoundary from '../EditSessionBoundary';
import type { GeometryField } from '@src/renderer/editor/runtime/elementOps';
import type {
  EditorPaintPropertyPatchV1,
  EditorShadowPropertyPatchV1,
  EditorPreviewStylePropertyPatchV1,
  EditorElementPropertyPatchV1,
} from '@src/types/editor';

const getStatTypeLabel = (statType?: StatItemType | null): string => {
  switch (statType) {
    case 'kpsAvg':
      return 'AVG';
    case 'kpsMax':
      return 'MAX';
    case 'total':
      return 'Total';
    case 'kps':
    default:
      return 'KPS';
  }
};

const RenameIcon: React.FC = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M12 20H21"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M16.5 3.5C17.3284 2.67157 18.6716 2.67157 19.5 3.5V3.5C20.3284 4.32843 20.3284 5.67157 19.5 6.5L7 19L3 20L4 16L16.5 3.5Z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// ============================================================================
// Plugin Selection Panel
// ============================================================================

interface PluginSelectionPanelProps {
  setPanelElement: (el: HTMLDivElement | null) => void;
  pluginTitle: string;
  setPluginScrollRef: (node: HTMLDivElement | null) => void;
  isPluginResizable: boolean;
  selectedPluginElement: PluginPanelElementView | null;
  pluginDisplaySize: { width: number; height: number };
  handlePluginPositionXChange: (value: number) => void;
  handlePluginPositionYChange: (value: number) => void;
  handlePluginWidthChange: (value: number) => void;
  handlePluginHeightChange: (value: number) => void;
  hasSinglePluginSelection: boolean;
  showModalHint: boolean;
  showSettings: boolean;
  renderPluginSettingsForm: (
    schema: Record<string, PluginSettingSchema> | undefined,
    values: Record<string, unknown>,
    messages: PluginMessages | undefined,
    pluginId: string,
    colorIdPrefix: string,
    onChange: (key: string, value: unknown) => void,
  ) => React.ReactNode;
  reportNormalizationError: (
    pluginId: string,
    key: string,
    error: unknown,
    kind: SettingsNormalizationErrorKind,
  ) => void;
  selectedPluginDefinition: PluginDefinitionInternal | null;
  resolvedPluginSettings: Record<string, unknown>;
  handlePluginSettingChange: (key: string, value: unknown) => void;
  t: (key: string) => string | undefined;
}

export const PluginSelectionPanel: React.FC<PluginSelectionPanelProps> = ({
  setPanelElement,
  pluginTitle,
  setPluginScrollRef,
  isPluginResizable,
  selectedPluginElement,
  pluginDisplaySize,
  handlePluginPositionXChange,
  handlePluginPositionYChange,
  handlePluginWidthChange,
  handlePluginHeightChange,
  hasSinglePluginSelection,
  showModalHint,
  showSettings,
  renderPluginSettingsForm,
  reportNormalizationError,
  selectedPluginDefinition,
  resolvedPluginSettings,
  handlePluginSettingChange,
  t,
}) => {
  // 위치 섹션도 설정 폼도 없을 때는 안내 문구만 남음 — 패널 세로 중앙에 배치
  // notice-only로 단락돼도 visibility 예외가 기록되도록 폼과 같은 리포터 전달
  const settingsRenderable =
    showSettings &&
    hasRenderableSettings(
      selectedPluginDefinition?.settings,
      resolvedPluginSettings,
      (key, error, kind) =>
        reportNormalizationError(
          selectedPluginDefinition?.pluginId ?? 'unknown',
          key,
          error,
          kind,
        ),
    );
  const noticeOnly = !isPluginResizable && !settingsRenderable;
  const noticeText = !hasSinglePluginSelection
    ? t('propertiesPanel.pluginMultiSelection') ||
      '플러그인 요소는 한 번에 하나만 편집할 수 있습니다.'
    : showModalHint
    ? t('propertiesPanel.pluginModalHint') ||
      '이 플러그인은 설정 모달을 사용합니다. 요소를 클릭해 설정하세요.'
    : t('propertiesPanel.pluginNoSettings') || '설정할 항목이 없습니다.';

  if (noticeOnly) {
    return (
      <div ref={setPanelElement} className={PANEL_ROOT_CLASS}>
        <div className={PANEL_HEADER_CLASS}>
          <span className="text-fg text-label leading-none truncate max-w-[120px]">
            {pluginTitle}
          </span>
        </div>
        <div className="flex-1 flex items-center justify-center px-[24px] pb-[48px]">
          <p className="text-fg-faint text-body text-center">{noticeText}</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={setPanelElement} className={PANEL_ROOT_CLASS}>
      <div className={PANEL_HEADER_CLASS}>
        <span className="text-fg text-label leading-none truncate max-w-[120px]">
          {pluginTitle}
        </span>
      </div>
      <div className="flex-1 properties-panel-overlay-scroll">
        <div
          ref={setPluginScrollRef}
          className="properties-panel-overlay-viewport"
          // blur가 확정 경계 - keystroke 단위가 아니라 포커스 이탈 시 즉시 커밋
          onBlurCapture={() => {
            const pluginId =
              selectedPluginElement?.pluginId ??
              selectedPluginDefinition?.pluginId;
            if (pluginId) flushPluginInstancesEditSession(pluginId);
          }}
        >
          <EditSessionBoundary>
            {isPluginResizable && (
              <PropertySection>
                <PropertyRow label={t('propertiesPanel.position') || '위치'}>
                  <NumberInput
                    value={selectedPluginElement?.position.x ?? 0}
                    onChange={handlePluginPositionXChange}
                    prefix="X"
                    width={AXIS_FIELD_WIDTH}
                    min={-9999}
                    max={9999}
                    allowDecimal
                    decimalScale={1}
                  />
                  <NumberInput
                    value={selectedPluginElement?.position.y ?? 0}
                    onChange={handlePluginPositionYChange}
                    prefix="Y"
                    width={AXIS_FIELD_WIDTH}
                    min={-9999}
                    max={9999}
                    allowDecimal
                    decimalScale={1}
                  />
                </PropertyRow>
                <PropertyRow label={t('propertiesPanel.size') || '크기'}>
                  <NumberInput
                    value={pluginDisplaySize.width}
                    onChange={handlePluginWidthChange}
                    prefix="W"
                    width={AXIS_FIELD_WIDTH}
                    min={10}
                    max={9999}
                    allowDecimal
                    decimalScale={1}
                  />
                  <NumberInput
                    value={pluginDisplaySize.height}
                    onChange={handlePluginHeightChange}
                    prefix="H"
                    width={AXIS_FIELD_WIDTH}
                    min={10}
                    max={9999}
                    allowDecimal
                    decimalScale={1}
                  />
                </PropertyRow>
              </PropertySection>
            )}
            {!hasSinglePluginSelection && (
              <p className="text-fg-faint text-body text-center">
                {t('propertiesPanel.pluginMultiSelection') ||
                  '플러그인 요소는 한 번에 하나만 편집할 수 있습니다.'}
              </p>
            )}
            {hasSinglePluginSelection && showModalHint && (
              <p className="text-fg-faint text-body text-center">
                {t('propertiesPanel.pluginModalHint') ||
                  '이 플러그인은 설정 모달을 사용합니다. 요소를 클릭해 설정하세요.'}
              </p>
            )}
            {showSettings &&
              renderPluginSettingsForm(
                selectedPluginDefinition?.settings,
                resolvedPluginSettings,
                selectedPluginDefinition?.messages,
                selectedPluginDefinition?.pluginId ?? 'unknown',
                `plugin-element-${selectedPluginElement?.fullId ?? 'unknown'}`,
                handlePluginSettingChange,
              )}
          </EditSessionBoundary>
        </div>
      </div>
    </div>
  );
};

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
  onElementPropertyCommit?: (patch: EditorElementPropertyPatchV1) => void;
  onInactiveImageCommit?: (inactiveImage: string) => void;
  onIdleTransparentCommit?: (idleTransparent: boolean) => void;
  onIdleImageFitCommit?: (idleImageFit: ImageFit) => void;
  onStylePropertyCommit?: (patch: EditorPreviewStylePropertyPatchV1) => void;
  onPaintCommit?: (patch: EditorPaintPropertyPatchV1) => void;
  handleGeometryCommit?: (field: GeometryField, value: number) => void;
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
  onInactiveImageCommit,
  onIdleTransparentCommit,
  onIdleImageFitCommit,
  onStylePropertyCommit,
  onPaintCommit,
  handleGeometryCommit,
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
              className="w-[18px] h-[18px] flex items-center justify-center text-white/45 hover:text-white/90 transition-colors flex-shrink-0"
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
                  value={Math.round(singleGraphPosition.dx || 0)}
                  onChange={(value) => {
                    handleGeometryCommit?.('dx', value);
                  }}
                  prefix="X"
                  width={AXIS_FIELD_WIDTH}
                  min={-9999}
                  max={9999}
                />
                <NumberInput
                  value={Math.round(singleGraphPosition.dy || 0)}
                  onChange={(value) => {
                    handleGeometryCommit?.('dy', value);
                  }}
                  prefix="Y"
                  width={AXIS_FIELD_WIDTH}
                  min={-9999}
                  max={9999}
                />
              </PropertyRow>

              <PropertyRow label={t('propertiesPanel.size') || 'Size'}>
                <NumberInput
                  value={Math.round(singleGraphPosition.width || 200)}
                  onChange={(value) => {
                    const width = Math.max(20, value);
                    handleGeometryCommit?.('width', width);
                  }}
                  prefix="W"
                  width={AXIS_FIELD_WIDTH}
                  min={20}
                  max={9999}
                />
                <NumberInput
                  value={Math.round(singleGraphPosition.height || 100)}
                  onChange={(value) => {
                    const height = Math.max(20, value);
                    handleGeometryCommit?.('height', height);
                  }}
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
                  onChangeComplete={(value) =>
                    onElementPropertyCommit?.({
                      property: 'graphColor',
                      value: value,
                    })
                  }
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
                  onModeCommit={(_state, modeValue) =>
                    onPaintCommit?.({
                      property: 'backgroundPaint',
                      value: paintDescriptor(modeValue),
                    })
                  }
                  colorId={`graph-bg-color-${selectedKeyType}-${singleGraphPosition.id}`}
                  panelElement={panelElement}
                />
              </PropertyRow>

              <PropertyRow
                label={t('propertiesPanel.borderColor') || 'Border Color'}
              >
                <ColorInput
                  value={
                    singleGraphPosition.borderColor || DEFAULT_ELEMENT_HAIRLINE
                  }
                  onChange={() => {}}
                  onChangeComplete={() => {}}
                  gradientValue={singleGraphPosition.borderGradient ?? null}
                  canvasAnchor={
                    singleGraphPosition.id &&
                    isNativeElementId(singleGraphPosition.id)
                      ? { kind: 'graph', id: singleGraphPosition.id }
                      : undefined
                  }
                  onModeCommit={(_state, modeValue) =>
                    onPaintCommit?.({
                      property: 'borderPaint',
                      value: paintDescriptor(modeValue),
                    })
                  }
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

// ============================================================================
// Single Knob Selection Panel
// ============================================================================

interface SingleKnobPanelProps {
  setPanelElement: (el: HTMLDivElement | null) => void;
  // 혼합 선택 시 패널 본문 상단에 표시할 플러그인 개수 안내
  singleKnobPosition: KnobItemPosition;
  selectedKeyType: string;
  isRenaming: boolean;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  renameValue: string;
  setRenameValue: (value: string) => void;
  renameCancelledRef: React.MutableRefObject<boolean>;
  handleRenameCommit: (value: string) => void;
  handleRenameCancel: () => void;
  handleRenameStart: () => void;
  onElementPropertyCommit?: (patch: EditorElementPropertyPatchV1) => void;
  onInactiveImageCommit?: (inactiveImage: string) => void;
  onActiveImageCommit?: (activeImage: string) => void;
  onIdleTransparentCommit?: (idleTransparent: boolean) => void;
  onActiveTransparentCommit?: (activeTransparent: boolean) => void;
  onIdleImageFitCommit?: (idleImageFit: ImageFit) => void;
  onActiveImageFitCommit?: (activeImageFit: ImageFit) => void;
  onStylePropertyCommit?: (patch: EditorPreviewStylePropertyPatchV1) => void;
  onPaintCommit?: (patch: EditorPaintPropertyPatchV1) => void;
  onShadowCommit?: (patch: EditorShadowPropertyPatchV1) => void;
  handleGeometryCommit?: (field: GeometryField, value: number) => void;
  singleScrollRefFor: (tab: TabType) => (node: HTMLDivElement | null) => void;
  panelElement: HTMLDivElement | null;
  useCustomCSS: boolean;
  t: (key: string) => string;
}

export const SingleKnobPanel: React.FC<SingleKnobPanelProps> = ({
  setPanelElement,
  singleKnobPosition,
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
  onInactiveImageCommit,
  onActiveImageCommit,
  onIdleTransparentCommit,
  onActiveTransparentCommit,
  onIdleImageFitCommit,
  onActiveImageFitCommit,
  onStylePropertyCommit,
  onPaintCommit,
  onShadowCommit,
  handleGeometryCommit,
  singleScrollRefFor,
  panelElement,
  useCustomCSS,
  t,
}) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const imageButtonRef = useRef<HTMLButtonElement | null>(null);
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [axisCaptureTarget, setAxisCaptureTarget] = useState<string | null>(
    null,
  );
  const [classNameDraft, setClassNameDraft] = useState(
    singleKnobPosition.className || '',
  );

  useEffect(() => {
    setClassNameDraft(singleKnobPosition.className || '');
  }, [selectedKeyType, singleKnobPosition.className, singleKnobPosition.id]);

  // 회전 감지 바인딩: 노브를 돌리면 가장 많이 움직인 축을 자동 바인딩
  useEffect(() => {
    if (!axisCaptureTarget) return;
    axisEventBus.initialize();
    const counts = new Map<string, number>();
    let bound = false;
    const unsub = axisEventBus.subscribe(({ axisId }) => {
      if (bound) return;
      const c = (counts.get(axisId) ?? 0) + 1;
      counts.set(axisId, c);
      if (c >= 3) {
        bound = true;
        const persisted =
          window.__dmn_window_type === 'panel'
            ? patchNativeLayerPropertyViaAuthority({
                elementType: 'knob',
                id: axisCaptureTarget,
                patch: { property: 'axisId', value: axisId },
              })
            : patchKnobAxisIdById(axisCaptureTarget, axisId);
        void persisted.catch(reportElementOpError);
        setAxisCaptureTarget(null);
      }
    });
    const timer = window.setTimeout(() => setAxisCaptureTarget(null), 6000);
    return () => {
      unsub();
      window.clearTimeout(timer);
    };
  }, [axisCaptureTarget]);

  const setRef = (node: HTMLDivElement | null) => {
    panelRef.current = node;
    setPanelElement(node);
  };

  const knobTitle = singleKnobPosition.layerName || 'Knob';
  const axisLabel = singleKnobPosition.axisId
    ? singleKnobPosition.axisId.replace(/^HIDA:/, '')
    : t('propertiesPanel.knobAxisUnset') || '미지정';

  // 대기/입력 색상 (키 패널과 동일한 기본값/전환 로직)
  const DEFAULT_KNOB_BACKGROUND_COLOR = DEFAULT_ELEMENT_BG;
  const DEFAULT_KNOB_BORDER_COLOR = DEFAULT_ELEMENT_FONT;
  const DEFAULT_KNOB_ACTIVE_BACKGROUND_COLOR = DEFAULT_ELEMENT_ACTIVE_BG;
  const DEFAULT_KNOB_ACTIVE_BORDER_COLOR = DEFAULT_ELEMENT_ACTIVE_FONT;

  type KnobColorTarget = 'backgroundColor' | 'borderColor';
  type KnobColorProperty =
    | KnobColorTarget
    | 'activeBackgroundColor'
    | 'activeBorderColor';

  const [pickerFor, setPickerFor] = useState<KnobColorTarget | null>(null);
  const [colorState, setColorState] = useState<'idle' | 'active'>('idle');
  const bgColorBtnRef = useRef<HTMLButtonElement>(null);
  const borderColorBtnRef = useRef<HTMLButtonElement>(null);

  const [localColors, setLocalColors] = useState<
    Record<KnobColorProperty, string>
  >({
    backgroundColor:
      singleKnobPosition.backgroundColor || DEFAULT_KNOB_BACKGROUND_COLOR,
    activeBackgroundColor:
      singleKnobPosition.activeBackgroundColor ||
      singleKnobPosition.backgroundColor ||
      DEFAULT_KNOB_ACTIVE_BACKGROUND_COLOR,
    borderColor: singleKnobPosition.borderColor || DEFAULT_KNOB_BORDER_COLOR,
    activeBorderColor:
      singleKnobPosition.activeBorderColor ||
      singleKnobPosition.borderColor ||
      DEFAULT_KNOB_ACTIVE_BORDER_COLOR,
  });

  // 피커는 대상 변경 시 닫는다. 축 캡처는 시작 ID를 별도로 동결하므로
  // 재정렬이나 모드 전환 뒤에도 시작 대상을 유지한다
  useEffect(() => {
    setPickerFor(null);
    setShowImagePicker(false);
  }, [selectedKeyType, singleKnobPosition.id]);

  // 피커가 닫혀있을 때만 외부 prop과 동기화
  useEffect(() => {
    if (!pickerFor) {
      setLocalColors({
        backgroundColor:
          singleKnobPosition.backgroundColor || DEFAULT_KNOB_BACKGROUND_COLOR,
        activeBackgroundColor:
          singleKnobPosition.activeBackgroundColor ||
          singleKnobPosition.backgroundColor ||
          DEFAULT_KNOB_ACTIVE_BACKGROUND_COLOR,
        borderColor:
          singleKnobPosition.borderColor || DEFAULT_KNOB_BORDER_COLOR,
        activeBorderColor:
          singleKnobPosition.activeBorderColor ||
          singleKnobPosition.borderColor ||
          DEFAULT_KNOB_ACTIVE_BORDER_COLOR,
      });
    }
  }, [
    pickerFor,
    singleKnobPosition.backgroundColor,
    singleKnobPosition.activeBackgroundColor,
    singleKnobPosition.borderColor,
    singleKnobPosition.activeBorderColor,
    DEFAULT_KNOB_BACKGROUND_COLOR,
    DEFAULT_KNOB_ACTIVE_BACKGROUND_COLOR,
    DEFAULT_KNOB_BORDER_COLOR,
    DEFAULT_KNOB_ACTIVE_BORDER_COLOR,
  ]);

  const resolveColorProperty = (target: KnobColorTarget): KnobColorProperty =>
    colorState === 'active'
      ? target === 'backgroundColor'
        ? 'activeBackgroundColor'
        : 'activeBorderColor'
      : target;

  const activeColorPropertyFor = (
    target: KnobColorTarget,
  ): 'activeBackgroundColor' | 'activeBorderColor' =>
    target === 'backgroundColor'
      ? 'activeBackgroundColor'
      : 'activeBorderColor';

  const isNonEmptyString = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0;

  const colorValueFor = (target: KnobColorTarget): string =>
    localColors[resolveColorProperty(target)];

  const handleColorChange = (target: KnobColorTarget, color: string) => {
    const prop = resolveColorProperty(target);
    setLocalColors((prev) => ({ ...prev, [prop]: color }));
  };

  // ── 그라데이션 배선 (키 패널과 동일 패턴) — 단색 커밋도 이 경로로 통합 ──

  const storedGradientOf = (prop: KnobColorProperty): GradientSpec | null => {
    switch (prop) {
      case 'backgroundColor':
        return singleKnobPosition.backgroundGradient ?? null;
      case 'activeBackgroundColor':
        return singleKnobPosition.activeBackgroundGradient ?? null;
      case 'borderColor':
        return singleKnobPosition.borderGradient ?? null;
      case 'activeBorderColor':
        return singleKnobPosition.activeBorderGradient ?? null;
      default:
        return null;
    }
  };

  const gradientSpecFor = (target: KnobColorTarget): GradientSpec | null => {
    const idleGradient = storedGradientOf(target);
    if (colorState !== 'active') return idleGradient;
    const activeProp = activeColorPropertyFor(target);
    const activeGradient = storedGradientOf(activeProp);
    const activeHasValue =
      isNonEmptyString(singleKnobPosition[activeProp]) ||
      activeGradient != null;
    return activeHasValue ? activeGradient : idleGradient;
  };

  const handleGradientCommit = (value: ColorModeValue) => {
    if (!pickerFor) return;
    const prop = resolveColorProperty(pickerFor);
    const descriptor = paintDescriptor(value);
    const paintField =
      colorState === 'active'
        ? pickerFor === 'backgroundColor'
          ? 'activeBackgroundPaint'
          : 'activeBorderPaint'
        : pickerFor === 'backgroundColor'
        ? 'backgroundPaint'
        : 'borderPaint';
    setLocalColors((prev) => ({ ...prev, [prop]: descriptor.color }));
    onPaintCommit?.({ property: paintField, value: descriptor } as never);
  };

  const knobGradientState = useGradientColorState({
    pair: pickerFor
      ? {
          color: colorValueFor(pickerFor),
          gradient: gradientSpecFor(pickerFor),
        }
      : {},
    fallbackColor: '#ffffff',
    contextKey: `knob:${selectedKeyType}:${singleKnobPosition.id}:${
      pickerFor ?? 'none'
    }:${colorState}`,
    canvasAnchor: pickerFor
      ? singleKnobPosition.id && isNativeElementId(singleKnobPosition.id)
        ? { kind: 'knob', id: singleKnobPosition.id }
        : undefined
      : undefined,
    canvasSurface: pickerFor === 'borderColor' ? 'border' : 'background',
    canvasState: colorState,
    onPreview: (value) => {
      if (value.mode === 'solid' && pickerFor) {
        handleColorChange(pickerFor, value.color);
      }
    },
    onCommit: handleGradientCommit,
  });

  const handlePickerToggle = (target: KnobColorTarget) => {
    setPickerFor((prev) => (prev === target ? null : target));
  };

  // 라운딩 기본값: 미지정 시 원형(짧은 변의 절반)
  const effectiveBorderRadius =
    singleKnobPosition.borderRadius ??
    Math.round(
      Math.min(
        singleKnobPosition.width || 60,
        singleKnobPosition.height || 60,
      ) / 2,
    );
  const knobIdleShadow = resolveElementShadowForPosition({
    position: singleKnobPosition,
    elementType: 'knob',
    active: false,
    defaultShadow: DEFAULT_ELEMENT_SHADOW_SPEC,
    defaultActiveShadow: DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
  });
  const knobActiveShadow = resolveElementShadowForPosition({
    position: singleKnobPosition,
    elementType: 'knob',
    active: true,
    defaultShadow: DEFAULT_ELEMENT_SHADOW_SPEC,
    defaultActiveShadow: DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
  });

  return (
    <div ref={setRef} className={PANEL_ROOT_CLASS}>
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
              title={knobTitle}
            >
              {knobTitle}
            </span>
            <button
              onClick={handleRenameStart}
              className="w-[18px] h-[18px] flex items-center justify-center text-white/45 hover:text-white/90 transition-colors flex-shrink-0"
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
            {/* 노브 매핑 (키 매핑과 동일한 라벨/버튼 구조) */}
            <PropertySection>
              <PropertyRow label={t('propertiesPanel.knobAxis') || '노브 매핑'}>
                <button
                  type="button"
                  onClick={() =>
                    setAxisCaptureTarget((current) =>
                      current
                        ? null
                        : singleKnobPosition.id &&
                          isNativeElementId(singleKnobPosition.id)
                        ? singleKnobPosition.id
                        : null,
                    )
                  }
                  className={`flex items-center justify-center h-[23px] min-w-[0px] px-[8px] bg-fill hover:bg-fill-hover active:bg-fill-active transition-colors duration-fast rounded-md ${
                    axisCaptureTarget ? 'shadow-focus-ring' : ''
                  } text-fg text-label`}
                  title={singleKnobPosition.axisId || ''}
                >
                  <span className="truncate max-w-[120px]">
                    {axisCaptureTarget
                      ? t('propertiesPanel.knobCapturing') || '감지 중…'
                      : singleKnobPosition.axisId
                      ? axisLabel
                      : t('propertiesPanel.knobCapture') || '노브 돌려서 감지'}
                  </span>
                </button>
              </PropertyRow>
            </PropertySection>

            <PropertySection>
              <PropertyRow label={t('propertiesPanel.position') || 'Position'}>
                <NumberInput
                  value={Math.round(singleKnobPosition.dx || 0)}
                  onChange={(value) => {
                    handleGeometryCommit?.('dx', value);
                  }}
                  prefix="X"
                  width={AXIS_FIELD_WIDTH}
                  min={-9999}
                  max={9999}
                />
                <NumberInput
                  value={Math.round(singleKnobPosition.dy || 0)}
                  onChange={(value) => {
                    handleGeometryCommit?.('dy', value);
                  }}
                  prefix="Y"
                  width={AXIS_FIELD_WIDTH}
                  min={-9999}
                  max={9999}
                />
              </PropertyRow>

              <PropertyRow label={t('propertiesPanel.size') || 'Size'}>
                <NumberInput
                  value={Math.round(singleKnobPosition.width || 60)}
                  onChange={(value) => {
                    const width = Math.max(20, value);
                    handleGeometryCommit?.('width', width);
                  }}
                  prefix="W"
                  width={AXIS_FIELD_WIDTH}
                  min={20}
                  max={9999}
                />
                <NumberInput
                  value={Math.round(singleKnobPosition.height || 60)}
                  onChange={(value) => {
                    const height = Math.max(20, value);
                    handleGeometryCommit?.('height', height);
                  }}
                  prefix="H"
                  width={AXIS_FIELD_WIDTH}
                  min={20}
                  max={9999}
                />
              </PropertyRow>
            </PropertySection>

            <PropertySection>
              {/* 회전 배율: 1 = 물리 1회전당 화면 1회전 (축 해상도 무관) */}
              <PropertyRow
                label={t('propertiesPanel.knobSensitivity') || '민감도'}
              >
                <NumberInput
                  value={Number(singleKnobPosition.sensitivity ?? 1)}
                  onChange={(value) =>
                    onElementPropertyCommit?.({
                      property: 'sensitivity',
                      value: Math.max(0, value),
                    })
                  }
                  suffix="×"
                  min={0}
                  max={100}
                  allowDecimal
                  decimalScale={2}
                />
              </PropertyRow>

              <div className="flex justify-between items-center w-full min-h-[32px]">
                <p className="text-fg-muted text-label">
                  {t('propertiesPanel.knobReverse') || '방향 반전'}
                </p>
                <Checkbox
                  commitStrategy="after-paint"
                  checked={singleKnobPosition.reverse ?? false}
                  onChange={() =>
                    onElementPropertyCommit?.({
                      property: 'reverse',
                      value: !(singleKnobPosition.reverse ?? false),
                    })
                  }
                />
              </div>
            </PropertySection>

            <PropertySection>
              {/* 배경색 (대기/입력 상태 전환은 피커 내부 토글) */}
              <PropertyRow
                label={t('propertiesPanel.backgroundColor') || '배경색'}
              >
                <ColorSwatchButton
                  ref={bgColorBtnRef}
                  type="button"
                  onClick={() => handlePickerToggle('backgroundColor')}
                  open={pickerFor === 'backgroundColor'}
                  className="w-[23px] h-[23px] rounded-md cursor-pointer transition-shadow flex-shrink-0"
                  surfaceClassName="rounded-md"
                  color={colorValueFor('backgroundColor')}
                  image={(() => {
                    const spec = gradientSpecFor('backgroundColor');
                    return spec ? gradientToCss(spec) : undefined;
                  })()}
                />
              </PropertyRow>

              {/* 테두리 색상 */}
              <PropertyRow
                label={t('propertiesPanel.borderColor') || '테두리 색상'}
              >
                <ColorSwatchButton
                  ref={borderColorBtnRef}
                  type="button"
                  onClick={() => handlePickerToggle('borderColor')}
                  open={pickerFor === 'borderColor'}
                  className="w-[23px] h-[23px] rounded-md cursor-pointer transition-shadow flex-shrink-0"
                  surfaceClassName="rounded-md"
                  color={colorValueFor('borderColor')}
                  image={(() => {
                    const spec = gradientSpecFor('borderColor');
                    return spec ? gradientToCss(spec) : undefined;
                  })()}
                />
              </PropertyRow>

              {/* 테두리 두께 */}
              <PropertyRow
                label={t('propertiesPanel.borderWidth') || '테두리 두께'}
              >
                <NumberInput
                  value={singleKnobPosition.borderWidth ?? 0}
                  onChange={(value) =>
                    onStylePropertyCommit?.({
                      property: 'borderWidth',
                      value: value,
                    })
                  }
                  suffix="px"
                  min={0}
                  max={20}
                />
              </PropertyRow>

              {/* 모서리 반경 (미지정 시 원형) */}
              <PropertyRow
                label={t('propertiesPanel.borderRadius') || '모서리 반경'}
              >
                <NumberInput
                  value={effectiveBorderRadius}
                  onChange={(value) =>
                    onStylePropertyCommit?.({
                      property: 'borderRadius',
                      value: value,
                    })
                  }
                  suffix="px"
                  min={0}
                  max={999}
                />
              </PropertyRow>

              <PropertyRow
                label={t('propertiesPanel.customImage') || 'Custom Image'}
              >
                <button
                  ref={imageButtonRef}
                  type="button"
                  className={`px-[8px] h-[23px] bg-fill hover:bg-fill-hover active:bg-fill-active transition-colors duration-fast rounded-md flex items-center justify-center ${
                    showImagePicker ? 'shadow-focus-ring' : ''
                  } text-fg text-body`}
                  onClick={() => setShowImagePicker(!showImagePicker)}
                >
                  {t('propertiesPanel.configure') || 'Configure'}
                </button>
              </PropertyRow>

              {useCustomCSS && (
                <>
                  <div className="flex justify-between items-center w-full min-h-[32px]">
                    <p className="text-fg-muted text-label">
                      {t('propertiesPanel.useInlineStyles') ||
                        '인라인 스타일 우선'}
                    </p>
                    <Checkbox
                      commitStrategy="after-paint"
                      checked={singleKnobPosition.useInlineStyles ?? false}
                      onChange={() =>
                        onElementPropertyCommit?.({
                          property: 'useInlineStyles',
                          value: !(singleKnobPosition.useInlineStyles ?? false),
                        })
                      }
                    />
                  </div>

                  <PropertyRow
                    label={t('propertiesPanel.className') || '클래스'}
                  >
                    <TextInput
                      value={classNameDraft}
                      onChange={setClassNameDraft}
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
                </>
              )}
            </PropertySection>

            <ShadowControls
              idleShadow={knobIdleShadow}
              activeShadow={knobActiveShadow}
              onChange={(state, _shadow, patch) => {
                const leaf = elementShadowLeafFromPartial(patch);
                if (!leaf) return;
                onShadowCommit?.(
                  state === 'active'
                    ? { property: 'activeShadow', value: leaf }
                    : { property: 'shadow', value: leaf },
                );
              }}
              onEnabledChange={(enabled) => {
                onShadowCommit?.({ property: 'shadowEnabled', value: enabled });
              }}
              panelElement={panelElement}
              t={t}
            />
          </EditSessionBoundary>
        </div>
      </div>

      <PopupExit open={showImagePicker}>
        {showImagePicker && imageButtonRef.current ? (
          <ImagePicker
            open={showImagePicker}
            referenceRef={imageButtonRef}
            panelElement={panelRef.current}
            completionBinding="element-id"
            idleImage={singleKnobPosition.inactiveImage || ''}
            activeImage={singleKnobPosition.activeImage || ''}
            idleTransparent={singleKnobPosition.idleTransparent ?? false}
            activeTransparent={singleKnobPosition.activeTransparent ?? false}
            idleImageFit={
              singleKnobPosition.idleImageFit ||
              singleKnobPosition.imageFit ||
              'cover'
            }
            activeImageFit={
              singleKnobPosition.activeImageFit ||
              singleKnobPosition.imageFit ||
              'cover'
            }
            onIdleImageChange={(imageUrl: string) =>
              onInactiveImageCommit?.(imageUrl)
            }
            onActiveImageChange={(imageUrl: string) =>
              onActiveImageCommit?.(imageUrl)
            }
            onIdleTransparentChange={(value: boolean) =>
              onIdleTransparentCommit?.(value)
            }
            onActiveTransparentChange={(value: boolean) =>
              onActiveTransparentCommit?.(value)
            }
            onIdleImageFitChange={(fit: string) =>
              onIdleImageFitCommit?.(fit as ImageFit)
            }
            onActiveImageFitChange={(fit: string) =>
              onActiveImageFitCommit?.(fit as ImageFit)
            }
            onIdleImageReset={() => onInactiveImageCommit?.('')}
            onActiveImageReset={() => onActiveImageCommit?.('')}
            onClose={() => setShowImagePicker(false)}
          />
        ) : null}
      </PopupExit>

      {/* 대기/입력 색상 ColorPicker (키 패널과 동일한 stateMode 토글) */}
      <PopupExit open={Boolean(pickerFor)}>
        {pickerFor ? (
          <ColorPicker
            open={!!pickerFor}
            referenceRef={
              pickerFor === 'backgroundColor'
                ? bgColorBtnRef
                : borderColorBtnRef
            }
            panelElement={panelElement}
            color={knobGradientState.pickerColor}
            onColorChange={(c: string) =>
              knobGradientState.handlePickerColorChange(c, false)
            }
            onColorChangeComplete={(c: string) =>
              knobGradientState.handlePickerColorChange(c, true)
            }
            onClose={() => setPickerFor(null)}
            solidOnly={true}
            stateMode={colorState}
            onStateModeChange={setColorState}
            interactiveRefs={[bgColorBtnRef, borderColorBtnRef]}
            headerSlot={knobGradientState.headerSlot}
            footerSlot={knobGradientState.footerSlot}
            gradientSpec={knobGradientState.paletteGradientSpec}
            onGradientSpecSelect={knobGradientState.handleGradientSpecSelect}
          />
        ) : null}
      </PopupExit>
    </div>
  );
};

// ============================================================================
// Single Key/Stat Selection Panel
// ============================================================================

interface SingleKeyStatPanelProps {
  setPanelElement: (el: HTMLDivElement | null) => void;
  // 혼합 선택 시 패널 본문 상단에 표시할 플러그인 개수 안내
  isSingleStat: boolean;
  isSingleKey: boolean;
  singleKeyIndex: number | null;
  singleStatIndex: number | null;
  singleKeyPosition: KeyPosition | null;
  singleStatPosition: StatItemPosition | null;
  singleKeyCode: string | null;
  singleKeySlot: KeySlot | null;
  singleKeyInfo: KeyInfo | null;
  selectedKeyType: string;
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
  onKeyMappingChange?: (index: number, newSlot: KeySlot) => void;
  localState: Partial<KeyPosition> & { dx?: number; dy?: number };
  setLocalState: React.Dispatch<
    React.SetStateAction<Partial<KeyPosition> & { dx?: number; dy?: number }>
  >;
  handleGeometryPreview?: (field: GeometryField, value: number) => void;
  handleGeometryCommit?: (field: GeometryField, value: number) => void;
  onElementPropertyCommit?: StyleTabContentProps['onElementPropertyCommit'];
  onInactiveImageCommit?: (inactiveImage: string) => void;
  onActiveImageCommit?: (activeImage: string) => void;
  onIdleTransparentCommit?: (idleTransparent: boolean) => void;
  onActiveTransparentCommit?: (activeTransparent: boolean) => void;
  onIdleImageFitCommit?: (idleImageFit: ImageFit) => void;
  onActiveImageFitCommit?: (activeImageFit: ImageFit) => void;
  onSoundPathCommit?: (soundPath: string) => void;
  onSoundEnabledCommit?: (soundEnabled: boolean) => void;
  onSoundVolumeCommit?: (soundVolume: number) => void;
  onStylePropertyPreview?: (patch: EditorPreviewStylePropertyPatchV1) => void;
  onStylePropertyCommit?: (patch: EditorPreviewStylePropertyPatchV1) => void;
  onPaintCommit?: (patch: EditorPaintPropertyPatchV1) => void;
  onFontColorCommit?: StyleTabContentProps['onFontColorCommit'];
  onShadowCommit?: (patch: EditorShadowPropertyPatchV1) => void;
  onNotePaintCommit?: NoteTabContentProps['onNotePaintCommit'];
  onNotePaintPreview?: NoteTabContentProps['onNotePaintPreview'];
  onCounterAnimationPresetCommit?: CounterTabContentProps['onCounterAnimationPresetCommit'];
  onCounterEnabledCommit?: CounterTabContentProps['onCounterEnabledCommit'];
  onCounterAnimationEnabledCommit?: CounterTabContentProps['onCounterAnimationEnabledCommit'];
  onCounterLayoutCommit?: CounterTabContentProps['onCounterLayoutCommit'];
  onCounterTypographyCommit?: CounterTabContentProps['onCounterTypographyCommit'];
  onCounterStrokeCommit?: CounterTabContentProps['onCounterStrokeCommit'];
  onCounterFillCommit?: CounterTabContentProps['onCounterFillCommit'];
  showImagePicker: boolean;
  setShowImagePicker: (value: boolean) => void;
  imageButtonRef: React.RefObject<HTMLButtonElement | null>;
  panelElement: HTMLDivElement | null;
  useCustomCSS: boolean;
  singleScrollRefFor: (tab: TabType) => (node: HTMLDivElement | null) => void;
  t: (key: string) => string | undefined;
}

export const SingleKeyStatPanel: React.FC<SingleKeyStatPanelProps> = ({
  setPanelElement,
  isSingleStat,
  isSingleKey: _isSingleKey,
  singleKeyIndex,
  singleStatIndex,
  singleKeyPosition,
  singleStatPosition,
  singleKeyCode,
  singleKeySlot,
  singleKeyInfo,
  selectedKeyType: _selectedKeyType,
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
  onKeyMappingChange,
  localState,
  setLocalState,
  handleGeometryPreview,
  handleGeometryCommit,
  onElementPropertyCommit,
  onInactiveImageCommit,
  onActiveImageCommit,
  onIdleTransparentCommit,
  onActiveTransparentCommit,
  onIdleImageFitCommit,
  onActiveImageFitCommit,
  onSoundPathCommit,
  onSoundEnabledCommit,
  onSoundVolumeCommit,
  onStylePropertyPreview,
  onStylePropertyCommit,
  onPaintCommit,
  onFontColorCommit,
  onShadowCommit,
  onNotePaintCommit,
  onNotePaintPreview,
  onCounterAnimationPresetCommit,
  onCounterEnabledCommit,
  onCounterAnimationEnabledCommit,
  onCounterLayoutCommit,
  onCounterTypographyCommit,
  onCounterStrokeCommit,
  onCounterFillCommit,
  showImagePicker,
  setShowImagePicker,
  imageButtonRef,
  panelElement,
  useCustomCSS,
  singleScrollRefFor,
  t,
}) => {
  const availableTabs = isSingleStat
    ? [TABS.STYLE, TABS.COUNTER]
    : [TABS.STYLE, TABS.NOTE, TABS.COUNTER];

  const resolvedStatType =
    (singleStatPosition?.statType as StatItemType) || 'kps';
  const statBaseValue = resolvedStatType === 'total' ? 'total' : 'kps';
  const statTitle = getStatTypeLabel(resolvedStatType);

  const keyLikeIndex = isSingleStat ? singleStatIndex! : singleKeyIndex!;
  const keyLikePosition: KeyPosition = isSingleStat
    ? singleStatPosition!
    : singleKeyPosition!;

  const keyLikeDefaultTitle = isSingleStat
    ? statTitle
    : singleKeyInfo?.displayName || singleKeyCode || 'Key';
  const keyLikeTitle = keyLikePosition?.layerName || keyLikeDefaultTitle;

  const keyLikeCode = isSingleStat ? null : singleKeyCode;
  const keyLikeInfo: KeyInfo | null = isSingleStat
    ? {
        browserKey: statTitle,
        globalKey: statTitle,
        displayName: statTitle,
      }
    : singleKeyInfo;

  const mappingControlLayout = isSingleStat ? (
    <>
      <PropertyRow label={t('propertiesPanel.statType') || 'Stat Type'}>
        <Dropdown
          commitStrategy="after-paint"
          options={STAT_BASE_OPTIONS}
          value={statBaseValue}
          onChange={(value) => {
            if (value === 'total') {
              onElementPropertyCommit?.({
                property: 'statType',
                value: 'total',
              });
              return;
            }
            onElementPropertyCommit?.({
              property: 'statType',
              value: resolvedStatType === 'total' ? 'kps' : resolvedStatType,
            });
          }}
        />
      </PropertyRow>
      {statBaseValue === 'kps' ? (
        <PropertyRow label={t('propertiesPanel.statKpsType') || 'KPS Type'}>
          <Dropdown
            commitStrategy="after-paint"
            options={STAT_KPS_OPTIONS}
            value={resolvedStatType}
            onChange={(value) =>
              onElementPropertyCommit?.({
                property: 'statType',
                value: value as StatItemType,
              })
            }
          />
        </PropertyRow>
      ) : null}
    </>
  ) : undefined;

  return (
    <div ref={setPanelElement} className={PANEL_ROOT_CLASS}>
      {/* 헤더 + 탭 영역 */}
      <div className="flex-shrink-0">
        {/* 헤더 */}
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
                className="text-fg text-label leading-none cursor-default truncate max-w-[110px]"
                onDoubleClick={handleRenameStart}
                title={keyLikeTitle}
              >
                {keyLikeTitle}
              </span>
              <button
                onClick={handleRenameStart}
                className="w-[18px] h-[18px] flex items-center justify-center text-white/45 hover:text-white/90 transition-colors flex-shrink-0"
                title={t('contextMenu.rename') || 'Rename'}
              >
                <RenameIcon />
              </button>
            </div>
          )}
        </div>

        {/* 탭 */}
        <div className="px-[12px] pb-[12px]">
          <Tabs
            activeTab={activeTab}
            onTabChange={setActiveTab}
            t={t}
            availableTabs={availableTabs}
          />
        </div>
      </div>

      {/* 스크롤 가능한 속성 영역 (탭별 독립 스크롤) */}
      <div className="flex-1 properties-panel-overlay-scroll">
        {/* STYLE 탭 viewport */}
        <div
          ref={singleScrollRefFor(TABS.STYLE)}
          className={`properties-panel-overlay-viewport ${
            activeTab === TABS.STYLE ? '' : 'hidden'
          }`}
        >
          <EditSessionBoundary>
            <StyleTabContent
              keyIndex={keyLikeIndex}
              keyPosition={keyLikePosition}
              keyCode={keyLikeCode}
              keyInfo={keyLikeInfo}
              onGeometryPreview={handleGeometryPreview}
              onGeometryCommit={handleGeometryCommit}
              onElementPropertyCommit={onElementPropertyCommit}
              canvasAnchor={
                keyLikePosition.id && isNativeElementId(keyLikePosition.id)
                  ? {
                      kind: isSingleStat ? 'stat' : 'key',
                      id: keyLikePosition.id,
                    }
                  : undefined
              }
              onKeyMappingChange={isSingleStat ? undefined : onKeyMappingChange}
              keySlot={isSingleStat ? undefined : singleKeySlot}
              mappingControlLayout={mappingControlLayout}
              mappingLabel={
                isSingleStat
                  ? t('propertiesPanel.statType') || 'Stat Type'
                  : undefined
              }
              showSoundControls={!isSingleStat}
              shadowActiveState={!isSingleStat}
              showImagePicker={showImagePicker}
              onToggleImagePicker={() => setShowImagePicker(!showImagePicker)}
              onInactiveImageCommit={onInactiveImageCommit}
              onActiveImageCommit={onActiveImageCommit}
              onIdleTransparentCommit={onIdleTransparentCommit}
              onActiveTransparentCommit={onActiveTransparentCommit}
              onIdleImageFitCommit={onIdleImageFitCommit}
              onActiveImageFitCommit={onActiveImageFitCommit}
              onSoundPathCommit={onSoundPathCommit}
              onSoundEnabledCommit={onSoundEnabledCommit}
              onSoundVolumeCommit={onSoundVolumeCommit}
              onStylePropertyPreview={onStylePropertyPreview}
              onStylePropertyCommit={onStylePropertyCommit}
              onPaintCommit={onPaintCommit}
              onFontColorCommit={onFontColorCommit}
              onShadowCommit={onShadowCommit}
              imageButtonRef={imageButtonRef}
              panelElement={panelElement}
              useCustomCSS={useCustomCSS}
              t={t}
              localDx={localState.dx}
              localDy={localState.dy}
              localWidth={localState.width}
              localHeight={localState.height}
              onLocalDxChange={(value) =>
                setLocalState((prev) => ({ ...prev, dx: value }))
              }
              onLocalDyChange={(value) =>
                setLocalState((prev) => ({ ...prev, dy: value }))
              }
              onLocalWidthChange={(value) =>
                setLocalState((prev) => ({ ...prev, width: value }))
              }
              onLocalHeightChange={(value) =>
                setLocalState((prev) => ({ ...prev, height: value }))
              }
            />
          </EditSessionBoundary>
        </div>

        {/* NOTE 탭 viewport */}
        {!isSingleStat && (
          <div
            ref={singleScrollRefFor(TABS.NOTE)}
            className={`properties-panel-overlay-viewport ${
              activeTab === TABS.NOTE ? '' : 'hidden'
            }`}
          >
            <EditSessionBoundary>
              <NoteTabContent
                keyPosition={singleKeyPosition!}
                onElementPropertyCommit={onElementPropertyCommit}
                onStylePropertyPreview={onStylePropertyPreview}
                onStylePropertyCommit={onStylePropertyCommit}
                onNotePaintPreview={onNotePaintPreview}
                onNotePaintCommit={onNotePaintCommit}
                panelElement={panelElement}
                t={t}
              />
            </EditSessionBoundary>
          </div>
        )}

        {/* COUNTER 탭 viewport */}
        <div
          ref={singleScrollRefFor(TABS.COUNTER)}
          className={`properties-panel-overlay-viewport ${
            activeTab === TABS.COUNTER ? '' : 'hidden'
          }`}
        >
          <EditSessionBoundary>
            <CounterTabContent
              keyPosition={keyLikePosition}
              keyDisplayName={keyLikeInfo?.displayName}
              isStat={isSingleStat}
              onCounterEnabledCommit={onCounterEnabledCommit}
              onCounterAnimationEnabledCommit={onCounterAnimationEnabledCommit}
              onCounterLayoutCommit={onCounterLayoutCommit}
              onCounterTypographyCommit={onCounterTypographyCommit}
              onCounterStrokeCommit={onCounterStrokeCommit}
              onCounterFillCommit={onCounterFillCommit}
              onCounterAnimationPresetCommit={onCounterAnimationPresetCommit}
              panelElement={panelElement}
              t={t}
            />
          </EditSessionBoundary>
        </div>
      </div>
    </div>
  );
};
