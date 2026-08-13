/* eslint-disable react-hooks/refs */
import React, { useEffect, useRef, useState } from 'react';
import { applyElementPatchById } from '@src/renderer/editor/runtime/elementPatch';
import { patchKnobAxisIdById } from '@src/renderer/editor/runtime/elementOps';
import { reportElementOpError } from '@src/renderer/editor/runtime/elementIntent';
import { isSyntheticElementId } from '@src/renderer/editor/model/elementIdMap';
import { patchNativeLayerPropertyViaAuthority } from '@plugins/rpc/pluginElementActions';
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
import type { CounterTabContentProps, SizeCommit } from '../types';
import {
  getActivePairPreservation,
  gradientPairPatch,
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
import { resolveElementShadow } from '@src/types/key/shadows';
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
  singleGraphPosition: GraphItemPosition;
  singleGraphIndex: number;
  selectedKeyType: string;
  isRenaming: boolean;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  renameValue: string;
  setRenameValue: (value: string) => void;
  renameCancelledRef: React.MutableRefObject<boolean>;
  handleRenameCommit: (value: string) => void;
  handleRenameCancel: () => void;
  handleRenameStart: () => void;
  handleGraphUpdate: (
    data: Partial<GraphItemPosition> & { index: number },
  ) => void;
  onInactiveImageCommit?: (inactiveImage: string) => void;
  onIdleTransparentCommit?: (idleTransparent: boolean) => void;
  onIdleImageFitCommit?: (idleImageFit: ImageFit) => void;
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
  singleGraphIndex,
  selectedKeyType,
  isRenaming,
  renameInputRef,
  renameValue,
  setRenameValue,
  renameCancelledRef,
  handleRenameCommit,
  handleRenameCancel,
  handleRenameStart,
  handleGraphUpdate,
  onInactiveImageCommit,
  onIdleTransparentCommit,
  onIdleImageFitCommit,
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
  // 이미지 대화상자 완료 전용. 대기 중 재정렬·모드 전환이 일어나도 id로
  // 현재 (mode, index)를 다시 찾아 적용하고, 삭제됐으면 조용히 중단한다
  const applyToGraphById = (patch: Omit<Partial<GraphItemPosition>, 'id'>) => {
    const id = singleGraphPosition.id;
    if (!id) {
      handleGraphUpdate({ index: singleGraphIndex, ...patch });
      return;
    }
    applyElementPatchById('graph', id, () => patch).catch(reportElementOpError);
  };

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
                    if (handleGeometryCommit) {
                      handleGeometryCommit('dx', value);
                    } else {
                      handleGraphUpdate({ index: singleGraphIndex, dx: value });
                    }
                  }}
                  prefix="X"
                  width={AXIS_FIELD_WIDTH}
                  min={-9999}
                  max={9999}
                />
                <NumberInput
                  value={Math.round(singleGraphPosition.dy || 0)}
                  onChange={(value) => {
                    if (handleGeometryCommit) {
                      handleGeometryCommit('dy', value);
                    } else {
                      handleGraphUpdate({ index: singleGraphIndex, dy: value });
                    }
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
                    if (handleGeometryCommit) {
                      handleGeometryCommit('width', width);
                    } else {
                      handleGraphUpdate({ index: singleGraphIndex, width });
                    }
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
                    if (handleGeometryCommit) {
                      handleGeometryCommit('height', height);
                    } else {
                      handleGraphUpdate({ index: singleGraphIndex, height });
                    }
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
                    handleGraphUpdate({
                      index: singleGraphIndex,
                      graphType: value as GraphItemType,
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
                      handleGraphUpdate({
                        index: singleGraphIndex,
                        showAvgLine: !(singleGraphPosition.showAvgLine ?? true),
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
                    handleGraphUpdate({
                      index: singleGraphIndex,
                      graphSpeed: snapped,
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
                    handleGraphUpdate({
                      index: singleGraphIndex,
                      graphColor: value,
                    })
                  }
                  colorId={`graph-color-${selectedKeyType}-${singleGraphIndex}`}
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
                    handleGraphUpdate({
                      index: singleGraphIndex,
                      graphAnimationEnabled: !(
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
                  onChangeComplete={(value) =>
                    handleGraphUpdate({
                      index: singleGraphIndex,
                      backgroundColor: value,
                    })
                  }
                  gradientValue={singleGraphPosition.backgroundGradient ?? null}
                  canvasAnchor={{ kind: 'graph', index: singleGraphIndex }}
                  onModeCommit={(_state, modeValue) =>
                    handleGraphUpdate({
                      index: singleGraphIndex,
                      ...gradientPairPatch('backgroundColor', modeValue),
                    })
                  }
                  colorId={`graph-bg-color-${selectedKeyType}-${singleGraphIndex}`}
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
                  onChangeComplete={(value) =>
                    handleGraphUpdate({
                      index: singleGraphIndex,
                      borderColor: value,
                    })
                  }
                  gradientValue={singleGraphPosition.borderGradient ?? null}
                  canvasAnchor={{ kind: 'graph', index: singleGraphIndex }}
                  onModeCommit={(_state, modeValue) =>
                    handleGraphUpdate({
                      index: singleGraphIndex,
                      ...gradientPairPatch('borderColor', modeValue),
                    })
                  }
                  colorId={`graph-border-color-${selectedKeyType}-${singleGraphIndex}`}
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
                    handleGraphUpdate({
                      index: singleGraphIndex,
                      borderWidth: Math.max(0, Math.min(20, value)),
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
                    handleGraphUpdate({
                      index: singleGraphIndex,
                      borderRadius: Math.max(0, Math.min(100, value)),
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
                      handleGraphUpdate({
                        index: singleGraphIndex,
                        useInlineStyles: !(
                          singleGraphPosition.useInlineStyles ?? false
                        ),
                      })
                    }
                  />
                </div>

                <PropertyRow label={t('propertiesPanel.className') || '클래스'}>
                  <TextInput
                    value={graphClassNameDraft}
                    onChange={setGraphClassNameDraft}
                    onBlur={(value) =>
                      handleGraphUpdate({
                        index: singleGraphIndex,
                        className: value,
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
            completionBinding={
              onInactiveImageCommit ||
              (singleGraphPosition.id &&
                !isSyntheticElementId(singleGraphPosition.id))
                ? 'element-id'
                : 'session-mode'
            }
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
              onInactiveImageCommit
                ? onInactiveImageCommit(imageUrl)
                : applyToGraphById({ inactiveImage: imageUrl })
            }
            onIdleTransparentChange={(value: boolean) =>
              onIdleTransparentCommit
                ? onIdleTransparentCommit(value)
                : handleGraphUpdate({
                    index: singleGraphIndex,
                    idleTransparent: value,
                  })
            }
            onIdleImageFitChange={(fit: string) =>
              onIdleImageFitCommit
                ? onIdleImageFitCommit(fit as ImageFit)
                : handleGraphUpdate({
                    index: singleGraphIndex,
                    idleImageFit: fit as ImageFit,
                  })
            }
            onIdleImageReset={() =>
              onInactiveImageCommit
                ? onInactiveImageCommit('')
                : handleGraphUpdate({
                    index: singleGraphIndex,
                    inactiveImage: '',
                  })
            }
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
  singleKnobPosition: KnobItemPosition;
  singleKnobIndex: number;
  selectedKeyType: string;
  isRenaming: boolean;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  renameValue: string;
  setRenameValue: (value: string) => void;
  renameCancelledRef: React.MutableRefObject<boolean>;
  handleRenameCommit: (value: string) => void;
  handleRenameCancel: () => void;
  handleRenameStart: () => void;
  handleKnobUpdate: (
    data: Partial<KnobItemPosition> & { index: number },
  ) => void;
  onInactiveImageCommit?: (inactiveImage: string) => void;
  onActiveImageCommit?: (activeImage: string) => void;
  onIdleTransparentCommit?: (idleTransparent: boolean) => void;
  onActiveTransparentCommit?: (activeTransparent: boolean) => void;
  onIdleImageFitCommit?: (idleImageFit: ImageFit) => void;
  onActiveImageFitCommit?: (activeImageFit: ImageFit) => void;
  handleGeometryCommit?: (field: GeometryField, value: number) => void;
  singleScrollRefFor: (tab: TabType) => (node: HTMLDivElement | null) => void;
  panelElement: HTMLDivElement | null;
  useCustomCSS: boolean;
  t: (key: string) => string;
}

export const SingleKnobPanel: React.FC<SingleKnobPanelProps> = ({
  setPanelElement,
  singleKnobPosition,
  singleKnobIndex,
  selectedKeyType,
  isRenaming,
  renameInputRef,
  renameValue,
  setRenameValue,
  renameCancelledRef,
  handleRenameCommit,
  handleRenameCancel,
  handleRenameStart,
  handleKnobUpdate,
  onInactiveImageCommit,
  onActiveImageCommit,
  onIdleTransparentCommit,
  onActiveTransparentCommit,
  onIdleImageFitCommit,
  onActiveImageFitCommit,
  handleGeometryCommit,
  singleScrollRefFor,
  panelElement,
  useCustomCSS,
  t,
}) => {
  // 이미지 대화상자 완료 전용. 대기 중 재정렬·모드 전환이 일어나도 id로
  // 현재 (mode, index)를 다시 찾아 적용하고, 삭제됐으면 조용히 중단한다
  const applyToKnobById = (patch: Omit<Partial<KnobItemPosition>, 'id'>) => {
    const id = singleKnobPosition.id;
    if (!id) {
      handleKnobUpdate({ index: singleKnobIndex, ...patch });
      return;
    }
    applyElementPatchById('knob', id, () => patch).catch(reportElementOpError);
  };

  const panelRef = useRef<HTMLDivElement | null>(null);
  const imageButtonRef = useRef<HTMLButtonElement | null>(null);
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [axisCaptureTarget, setAxisCaptureTarget] = useState<{
    id: string | null;
    index: number;
  } | null>(null);
  const [classNameDraft, setClassNameDraft] = useState(
    singleKnobPosition.className || '',
  );

  useEffect(() => {
    setClassNameDraft(singleKnobPosition.className || '');
  }, [singleKnobIndex, selectedKeyType, singleKnobPosition.className]);

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
        if (axisCaptureTarget.id) {
          const persisted =
            window.__dmn_window_type === 'panel'
              ? patchNativeLayerPropertyViaAuthority({
                  elementType: 'knob',
                  id: axisCaptureTarget.id,
                  patch: { axisId },
                })
              : patchKnobAxisIdById(axisCaptureTarget.id, axisId);
          void persisted.catch(reportElementOpError);
        } else {
          handleKnobUpdate({ index: axisCaptureTarget.index, axisId });
        }
        setAxisCaptureTarget(null);
      }
    });
    const timer = window.setTimeout(() => setAxisCaptureTarget(null), 6000);
    return () => {
      unsub();
      window.clearTimeout(timer);
    };
  }, [axisCaptureTarget, handleKnobUpdate]);

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

  // 피커는 대상 변경 시 닫는다. 축 캡처는 시작 ID/index를 별도로 동결하므로
  // 재정렬이나 모드 전환 뒤에도 시작 대상을 유지한다
  useEffect(() => {
    setPickerFor(null);
    setShowImagePicker(false);
    setAxisCaptureTarget((current) =>
      current && !current.id ? null : current,
    );
  }, [singleKnobIndex, selectedKeyType]);

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
    const patch = gradientPairPatch(
      prop as Parameters<typeof gradientPairPatch>[0],
      value,
    ) as Partial<KnobItemPosition>;

    const baseColor = patch[prop];
    if (typeof baseColor === 'string') {
      setLocalColors((prev) => ({ ...prev, [prop]: baseColor }));
    }

    const updates: Partial<KnobItemPosition> = { ...patch };

    // idle 편집 전 사용자 저장값 기준 active 쌍 보존
    if (colorState !== 'active') {
      const activeProp = activeColorPropertyFor(pickerFor);
      const preservation = getActivePairPreservation(
        {
          color: singleKnobPosition[pickerFor],
          gradient: storedGradientOf(pickerFor),
        },
        {
          color: singleKnobPosition[activeProp],
          gradient: storedGradientOf(activeProp),
        },
      );
      if (preservation?.color !== undefined) {
        updates[activeProp] = preservation.color;
      }
      if (preservation?.gradient !== undefined) {
        const activeSibling =
          pickerFor === 'backgroundColor'
            ? 'activeBackgroundGradient'
            : 'activeBorderGradient';
        updates[activeSibling] = preservation.gradient;
      }
    }

    handleKnobUpdate({ index: singleKnobIndex, ...updates });
  };

  const knobGradientState = useGradientColorState({
    pair: pickerFor
      ? {
          color: colorValueFor(pickerFor),
          gradient: gradientSpecFor(pickerFor),
        }
      : {},
    fallbackColor: '#ffffff',
    contextKey: `knob:${selectedKeyType}:${singleKnobIndex}:${
      pickerFor ?? 'none'
    }:${colorState}`,
    canvasAnchor: pickerFor
      ? { kind: 'knob', index: singleKnobIndex }
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
  const knobHasIdleImage = Boolean(singleKnobPosition.inactiveImage?.trim());
  const knobHasActiveImage = Boolean(
    singleKnobPosition.activeImage?.trim() ||
      singleKnobPosition.inactiveImage?.trim(),
  );
  const suppressKnobDefaultShadow = (singleKnobPosition.borderWidth ?? 0) > 0;
  const knobIdleShadow = resolveElementShadow({
    active: false,
    shadow: singleKnobPosition.shadow,
    activeShadow: singleKnobPosition.activeShadow,
    defaultShadow: DEFAULT_ELEMENT_SHADOW_SPEC,
    defaultActiveShadow: DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
    suppressDefault:
      knobHasIdleImage ||
      singleKnobPosition.idleTransparent === true ||
      suppressKnobDefaultShadow,
  });
  const knobActiveShadow = resolveElementShadow({
    active: true,
    shadow: singleKnobPosition.shadow,
    activeShadow: singleKnobPosition.activeShadow,
    defaultShadow: DEFAULT_ELEMENT_SHADOW_SPEC,
    defaultActiveShadow: DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
    suppressDefault:
      knobHasActiveImage ||
      singleKnobPosition.activeTransparent === true ||
      suppressKnobDefaultShadow,
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
                        : {
                            id:
                              singleKnobPosition.id &&
                              !isSyntheticElementId(singleKnobPosition.id)
                                ? singleKnobPosition.id
                                : null,
                            index: singleKnobIndex,
                          },
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
                    if (handleGeometryCommit) {
                      handleGeometryCommit('dx', value);
                    } else {
                      handleKnobUpdate({ index: singleKnobIndex, dx: value });
                    }
                  }}
                  prefix="X"
                  width={AXIS_FIELD_WIDTH}
                  min={-9999}
                  max={9999}
                />
                <NumberInput
                  value={Math.round(singleKnobPosition.dy || 0)}
                  onChange={(value) => {
                    if (handleGeometryCommit) {
                      handleGeometryCommit('dy', value);
                    } else {
                      handleKnobUpdate({ index: singleKnobIndex, dy: value });
                    }
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
                    if (handleGeometryCommit) {
                      handleGeometryCommit('width', width);
                    } else {
                      handleKnobUpdate({ index: singleKnobIndex, width });
                    }
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
                    if (handleGeometryCommit) {
                      handleGeometryCommit('height', height);
                    } else {
                      handleKnobUpdate({ index: singleKnobIndex, height });
                    }
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
                    handleKnobUpdate({
                      index: singleKnobIndex,
                      sensitivity: Math.max(0, value),
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
                    handleKnobUpdate({
                      index: singleKnobIndex,
                      reverse: !(singleKnobPosition.reverse ?? false),
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
                    handleKnobUpdate({
                      index: singleKnobIndex,
                      borderWidth: value,
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
                    handleKnobUpdate({
                      index: singleKnobIndex,
                      borderRadius: value,
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
                        handleKnobUpdate({
                          index: singleKnobIndex,
                          useInlineStyles: !(
                            singleKnobPosition.useInlineStyles ?? false
                          ),
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
                        handleKnobUpdate({
                          index: singleKnobIndex,
                          className: value,
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
              onChange={(state, shadow) =>
                handleKnobUpdate({
                  index: singleKnobIndex,
                  [state === 'active' ? 'activeShadow' : 'shadow']: shadow,
                })
              }
              onEnabledChange={(enabled) =>
                handleKnobUpdate({
                  index: singleKnobIndex,
                  shadow: { ...knobIdleShadow, enabled },
                  activeShadow: { ...knobActiveShadow, enabled },
                })
              }
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
            completionBinding={
              onInactiveImageCommit ||
              onActiveImageCommit ||
              (singleKnobPosition.id &&
                !isSyntheticElementId(singleKnobPosition.id))
                ? 'element-id'
                : 'session-mode'
            }
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
              onInactiveImageCommit
                ? onInactiveImageCommit(imageUrl)
                : applyToKnobById({ inactiveImage: imageUrl })
            }
            onActiveImageChange={(imageUrl: string) =>
              onActiveImageCommit
                ? onActiveImageCommit(imageUrl)
                : applyToKnobById({ activeImage: imageUrl })
            }
            onIdleTransparentChange={(value: boolean) =>
              onIdleTransparentCommit
                ? onIdleTransparentCommit(value)
                : handleKnobUpdate({
                    index: singleKnobIndex,
                    idleTransparent: value,
                  })
            }
            onActiveTransparentChange={(value: boolean) =>
              onActiveTransparentCommit
                ? onActiveTransparentCommit(value)
                : handleKnobUpdate({
                    index: singleKnobIndex,
                    activeTransparent: value,
                  })
            }
            onIdleImageFitChange={(fit: string) =>
              onIdleImageFitCommit
                ? onIdleImageFitCommit(fit as ImageFit)
                : handleKnobUpdate({
                    index: singleKnobIndex,
                    idleImageFit: fit as ImageFit,
                  })
            }
            onActiveImageFitChange={(fit: string) =>
              onActiveImageFitCommit
                ? onActiveImageFitCommit(fit as ImageFit)
                : handleKnobUpdate({
                    index: singleKnobIndex,
                    activeImageFit: fit as ImageFit,
                  })
            }
            onIdleImageReset={() =>
              onInactiveImageCommit
                ? onInactiveImageCommit('')
                : handleKnobUpdate({
                    index: singleKnobIndex,
                    inactiveImage: '',
                  })
            }
            onActiveImageReset={() =>
              onActiveImageCommit
                ? onActiveImageCommit('')
                : handleKnobUpdate({ index: singleKnobIndex, activeImage: '' })
            }
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
  onPositionChange: (index: number, dx: number, dy: number) => void;
  onKeyUpdate: (data: Partial<KeyPosition> & { index: number }) => void;
  onKeyPreview?: (index: number, updates: Partial<KeyPosition>) => void;
  onKeyMappingChange?: (index: number, newSlot: KeySlot) => void;
  handleStatUpdate: (
    data: Partial<StatItemPosition> & { index: number },
  ) => void;
  handleStatPreview: (
    index: number,
    updates: Partial<StatItemPosition>,
  ) => void;
  localState: Partial<KeyPosition> & { dx?: number; dy?: number };
  setLocalState: React.Dispatch<
    React.SetStateAction<Partial<KeyPosition> & { dx?: number; dy?: number }>
  >;
  handleSizeBlur: (committed?: SizeCommit) => void;
  handleGeometryCommit?: (field: GeometryField, value: number) => void;
  onInactiveImageCommit?: (inactiveImage: string) => void;
  onActiveImageCommit?: (activeImage: string) => void;
  onIdleTransparentCommit?: (idleTransparent: boolean) => void;
  onActiveTransparentCommit?: (activeTransparent: boolean) => void;
  onIdleImageFitCommit?: (idleImageFit: ImageFit) => void;
  onActiveImageFitCommit?: (activeImageFit: ImageFit) => void;
  onSoundPathCommit?: (soundPath: string) => void;
  onSoundEnabledCommit?: (soundEnabled: boolean) => void;
  onSoundVolumeCommit?: (soundVolume: number) => void;
  onCounterAnimationPresetCommit?: CounterTabContentProps['onCounterAnimationPresetCommit'];
  onCounterEnabledCommit?: CounterTabContentProps['onCounterEnabledCommit'];
  onCounterAnimationEnabledCommit?: CounterTabContentProps['onCounterAnimationEnabledCommit'];
  onCounterLayoutCommit?: CounterTabContentProps['onCounterLayoutCommit'];
  onCounterTypographyCommit?: CounterTabContentProps['onCounterTypographyCommit'];
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
  onPositionChange,
  onKeyUpdate,
  onKeyPreview,
  onKeyMappingChange,
  handleStatUpdate,
  handleStatPreview,
  localState,
  setLocalState,
  handleSizeBlur,
  handleGeometryCommit,
  onInactiveImageCommit,
  onActiveImageCommit,
  onIdleTransparentCommit,
  onActiveTransparentCommit,
  onIdleImageFitCommit,
  onActiveImageFitCommit,
  onSoundPathCommit,
  onSoundEnabledCommit,
  onSoundVolumeCommit,
  onCounterAnimationPresetCommit,
  onCounterEnabledCommit,
  onCounterAnimationEnabledCommit,
  onCounterLayoutCommit,
  onCounterTypographyCommit,
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

  const handleKeyLikePositionChange = isSingleStat
    ? (index: number, dx: number, dy: number) =>
        handleStatUpdate({ index, dx, dy })
    : onPositionChange;

  const handleKeyLikeUpdate = isSingleStat
    ? (data: Partial<KeyPosition> & { index: number }) =>
        handleStatUpdate(data as Partial<StatItemPosition> & { index: number })
    : onKeyUpdate;

  const handleKeyLikePreview = isSingleStat
    ? (index: number, updates: Partial<KeyPosition>) =>
        handleStatPreview(index, updates as Partial<StatItemPosition>)
    : onKeyPreview;

  const mappingControlLayout = isSingleStat ? (
    <>
      <PropertyRow label={t('propertiesPanel.statType') || 'Stat Type'}>
        <Dropdown
          commitStrategy="after-paint"
          options={STAT_BASE_OPTIONS}
          value={statBaseValue}
          onChange={(value) => {
            if (value === 'total') {
              handleStatUpdate({
                index: singleStatIndex!,
                statType: 'total',
              });
              return;
            }
            handleStatUpdate({
              index: singleStatIndex!,
              statType: resolvedStatType === 'total' ? 'kps' : resolvedStatType,
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
              handleStatUpdate({
                index: singleStatIndex!,
                statType: value as StatItemType,
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
              onPositionChange={handleKeyLikePositionChange}
              onKeyUpdate={handleKeyLikeUpdate}
              onKeyPreview={handleKeyLikePreview}
              canvasAnchor={{
                kind: isSingleStat ? 'stat' : 'key',
                index: keyLikeIndex,
              }}
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
              onSizeBlur={handleSizeBlur}
              onGeometryCommit={handleGeometryCommit}
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
                keyIndex={singleKeyIndex!}
                keyPosition={singleKeyPosition!}
                onKeyUpdate={onKeyUpdate}
                onKeyPreview={onKeyPreview}
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
              keyIndex={keyLikeIndex}
              keyPosition={keyLikePosition}
              keyDisplayName={keyLikeInfo?.displayName}
              isStat={isSingleStat}
              onKeyUpdate={handleKeyLikeUpdate}
              onCounterEnabledCommit={onCounterEnabledCommit}
              onCounterAnimationEnabledCommit={onCounterAnimationEnabledCommit}
              onCounterLayoutCommit={onCounterLayoutCommit}
              onCounterTypographyCommit={onCounterTypographyCommit}
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
