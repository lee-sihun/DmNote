/* eslint-disable react-hooks/refs */
import React, { useEffect, useRef, useState } from 'react';
import type { ImageFit, KeyPosition } from '@src/types/key/keys';
import type { StatItemPosition, StatItemType } from '@src/types/key/statItems';
import type {
  GraphItemPosition,
  GraphItemType,
} from '@src/types/key/graphItems';
import type { KnobItemPosition } from '@src/types/key/knobs';
import { axisEventBus } from '@utils/core/axisEventBus';
import type {
  PluginSettingSchema,
  PluginMessages,
  PluginDefinitionInternal,
  PluginDisplayElementInternal,
} from '@src/types/plugin/api';
import type { KeyInfo } from '@utils/core/KeyMaps';
import {
  PropertyRow,
  NumberInput,
  TextInput,
  ColorInput,
  SectionDivider,
  SidebarToggleIcon,
  ModeToggleIcon,
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
import ImagePicker from '@components/main/Modal/content/pickers/ImagePicker';

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
  handleToggleMode: () => void;
  handleTogglePanel: () => void;
  setPluginScrollRef: (node: HTMLDivElement | null) => void;
  setPluginThumbRef: (node: HTMLDivElement | null) => void;
  isPluginResizable: boolean;
  selectedPluginElement: PluginDisplayElementInternal | null;
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
    colorIdPrefix: string,
    onChange: (key: string, value: unknown) => void,
    options?: { wrap?: boolean },
  ) => React.ReactNode;
  selectedPluginDefinition: PluginDefinitionInternal | null;
  resolvedPluginSettings: Record<string, unknown>;
  handlePluginSettingChange: (key: string, value: unknown) => void;
  t: (key: string) => string | undefined;
}

export const PluginSelectionPanel: React.FC<PluginSelectionPanelProps> = ({
  setPanelElement,
  pluginTitle,
  handleToggleMode,
  handleTogglePanel,
  setPluginScrollRef,
  setPluginThumbRef,
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
  selectedPluginDefinition,
  resolvedPluginSettings,
  handlePluginSettingChange,
  t,
}) => {
  return (
    <div
      ref={setPanelElement}
      className="absolute right-0 top-0 bottom-0 w-[220px] bg-glass backdrop-blur-[24px] shadow-elevation-panel flex flex-col z-30"
    >
      <div className="flex items-center justify-between p-[12px]">
        <span className="text-fg text-style-2 truncate max-w-[120px]">
          {pluginTitle}
        </span>
        <div className="flex items-center gap-[4px]">
          <button
            onClick={handleToggleMode}
            className="w-[24px] h-[24px] flex items-center justify-center hover:bg-surface-hover rounded-[4px] transition-colors"
            title={t('propertiesPanel.switchToLayer') || 'Switch to Layer'}
          >
            <ModeToggleIcon mode="layer" />
          </button>
          <button
            onClick={handleTogglePanel}
            className="w-[24px] h-[24px] flex items-center justify-center hover:bg-surface-hover rounded-[4px] transition-colors"
            title={t('propertiesPanel.closePanel') || '속성 패널 닫기'}
          >
            <SidebarToggleIcon isOpen={true} />
          </button>
        </div>
      </div>
      <div className="flex-1 properties-panel-overlay-scroll">
        <div
          ref={setPluginScrollRef}
          className="properties-panel-overlay-viewport"
        >
          <div className="p-[12px] flex flex-col gap-[12px]">
            {isPluginResizable && (
              <>
                <PropertyRow label={t('propertiesPanel.position') || '위치'}>
                  <NumberInput
                    value={selectedPluginElement?.position.x ?? 0}
                    onChange={handlePluginPositionXChange}
                    prefix="X"
                    min={-9999}
                    max={9999}
                    allowDecimal
                    decimalScale={1}
                  />
                  <NumberInput
                    value={selectedPluginElement?.position.y ?? 0}
                    onChange={handlePluginPositionYChange}
                    prefix="Y"
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
                    min={10}
                    max={9999}
                    allowDecimal
                    decimalScale={1}
                  />
                  <NumberInput
                    value={pluginDisplaySize.height}
                    onChange={handlePluginHeightChange}
                    prefix="H"
                    min={10}
                    max={9999}
                    allowDecimal
                    decimalScale={1}
                  />
                </PropertyRow>
                <SectionDivider />
              </>
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
                `plugin-element-${selectedPluginElement?.fullId ?? 'unknown'}`,
                handlePluginSettingChange,
                { wrap: false },
              )}
          </div>
          <div className="properties-panel-overlay-bar">
            <div
              ref={setPluginThumbRef}
              className="properties-panel-overlay-thumb"
              style={{ display: 'none' }}
            />
          </div>
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
  handleToggleMode: () => void;
  handleTogglePanel: () => void;
  handleGraphUpdate: (
    data: Partial<GraphItemPosition> & { index: number },
  ) => void;
  singleScrollRefFor: (tab: TabType) => (node: HTMLDivElement | null) => void;
  singleThumbRefFor: (tab: TabType) => (node: HTMLDivElement | null) => void;
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
  handleToggleMode,
  handleTogglePanel,
  handleGraphUpdate,
  singleScrollRefFor,
  singleThumbRefFor,
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
    <div
      ref={setPanelElement}
      className="absolute right-0 top-0 bottom-0 w-[220px] bg-glass backdrop-blur-[24px] shadow-elevation-panel flex flex-col z-30"
    >
      <div className="flex items-center justify-between p-[12px]">
        {isRenaming ? (
          <input
            ref={renameInputRef}
            type="text"
            className="text-fg text-style-2 bg-transparent border-none p-0 outline-none w-[130px] caret-accent"
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
              className="text-fg text-style-2 truncate max-w-[100px] cursor-default"
              onDoubleClick={handleRenameStart}
              title={graphTitle}
            >
              {graphTitle}
            </span>
            <button
              onClick={handleRenameStart}
              className="w-[18px] h-[18px] flex items-center justify-center text-fg-faint hover:text-fg hover:bg-surface-hover rounded-[4px] transition-colors flex-shrink-0"
              title={t('contextMenu.rename') || 'Rename'}
            >
              <RenameIcon />
            </button>
          </div>
        )}
        <div className="flex items-center gap-[4px]">
          <button
            onClick={handleToggleMode}
            className="w-[24px] h-[24px] flex items-center justify-center hover:bg-surface-hover rounded-[4px] transition-colors"
            title={t('propertiesPanel.switchToLayer') || 'Switch to Layer'}
          >
            <ModeToggleIcon mode="layer" />
          </button>
          <button
            onClick={handleTogglePanel}
            className="w-[24px] h-[24px] flex items-center justify-center hover:bg-surface-hover rounded-[4px] transition-colors"
            title={t('propertiesPanel.closePanel') || 'Close'}
          >
            <SidebarToggleIcon isOpen={true} />
          </button>
        </div>
      </div>
      <div className="flex-1 properties-panel-overlay-scroll">
        <div
          ref={singleScrollRefFor(TABS.STYLE)}
          className="properties-panel-overlay-viewport"
        >
          <div className="p-[12px] flex flex-col gap-[12px]">
            <PropertyRow label={t('propertiesPanel.position') || 'Position'}>
              <NumberInput
                value={Math.round(singleGraphPosition.dx || 0)}
                onChange={(value) =>
                  handleGraphUpdate({
                    index: singleGraphIndex,
                    dx: value,
                  })
                }
                prefix="X"
                min={-9999}
                max={9999}
              />
              <NumberInput
                value={Math.round(singleGraphPosition.dy || 0)}
                onChange={(value) =>
                  handleGraphUpdate({
                    index: singleGraphIndex,
                    dy: value,
                  })
                }
                prefix="Y"
                min={-9999}
                max={9999}
              />
            </PropertyRow>

            <PropertyRow label={t('propertiesPanel.size') || 'Size'}>
              <NumberInput
                value={Math.round(singleGraphPosition.width || 200)}
                onChange={(value) =>
                  handleGraphUpdate({
                    index: singleGraphIndex,
                    width: Math.max(20, value),
                  })
                }
                prefix="W"
                min={20}
                max={9999}
              />
              <NumberInput
                value={Math.round(singleGraphPosition.height || 100)}
                onChange={(value) =>
                  handleGraphUpdate({
                    index: singleGraphIndex,
                    height: Math.max(20, value),
                  })
                }
                prefix="H"
                min={20}
                max={9999}
              />
            </PropertyRow>

            <SectionDivider />

            <PropertyRow
              label={t('propertiesPanel.graphShape') || 'Graph Shape'}
            >
              <Dropdown
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
              <div className="flex justify-between items-center w-full h-[23px]">
                <p className="text-fg-muted text-label">
                  {t('propertiesPanel.graphShowAverageLine') ||
                    'Show Average Line'}
                </p>
                <Checkbox
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

            <div className="flex justify-between items-center w-full h-[23px]">
              <p className="text-fg-muted text-label">
                {t('propertiesPanel.graphAnimation') || 'Graph Animation'}
              </p>
              <Checkbox
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

            <SectionDivider />

            <PropertyRow
              label={t('propertiesPanel.backgroundColor') || 'Background Color'}
            >
              <ColorInput
                value={
                  singleGraphPosition.backgroundColor || 'rgba(17, 17, 20, 0.9)'
                }
                onChange={() => {}}
                onChangeComplete={(value) =>
                  handleGraphUpdate({
                    index: singleGraphIndex,
                    backgroundColor: value,
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
                  singleGraphPosition.borderColor || 'rgba(255, 255, 255, 0.1)'
                }
                onChange={() => {}}
                onChangeComplete={(value) =>
                  handleGraphUpdate({
                    index: singleGraphIndex,
                    borderColor: value,
                  })
                }
                colorId={`graph-border-color-${selectedKeyType}-${singleGraphIndex}`}
                panelElement={panelElement}
              />
            </PropertyRow>

            <PropertyRow
              label={t('propertiesPanel.borderWidth') || 'Border Width'}
            >
              <NumberInput
                value={Math.round(singleGraphPosition.borderWidth ?? 3)}
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
                value={Math.round(singleGraphPosition.borderRadius ?? 8)}
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
                className={`px-[8px] h-[23px] bg-white/[0.07] hover:bg-white/[0.1] active:bg-white/[0.13] transition-colors duration-fast rounded-md flex items-center justify-center ${
                  showGraphImagePicker ? 'shadow-focus-ring' : ''
                } text-fg text-body`}
                onClick={() => setShowGraphImagePicker(!showGraphImagePicker)}
              >
                {t('propertiesPanel.configure') || 'Configure'}
              </button>
            </PropertyRow>

            {useCustomCSS && (
              <>
                <SectionDivider />

                <div className="flex justify-between items-center w-full h-[23px]">
                  <p className="text-fg-muted text-label">
                    {t('propertiesPanel.useInlineStyles') ||
                      '인라인 스타일 우선'}
                  </p>
                  <Checkbox
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
                    onBlur={() =>
                      handleGraphUpdate({
                        index: singleGraphIndex,
                        className: graphClassNameDraft || '',
                      })
                    }
                    placeholder="className"
                    width="90px"
                  />
                </PropertyRow>
              </>
            )}
          </div>
          <div className="properties-panel-overlay-bar">
            <div
              ref={singleThumbRefFor(TABS.STYLE)}
              className="properties-panel-overlay-thumb"
              style={{ display: 'none' }}
            />
          </div>
        </div>
      </div>

      {showGraphImagePicker && graphImageButtonRef.current && (
        <ImagePicker
          open={showGraphImagePicker}
          referenceRef={graphImageButtonRef}
          panelElement={panelElement}
          idleImage={singleGraphPosition.inactiveImage || ''}
          activeImage={singleGraphPosition.activeImage || ''}
          idleTransparent={false}
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
            handleGraphUpdate({
              index: singleGraphIndex,
              inactiveImage: imageUrl,
            })
          }
          onActiveImageChange={(imageUrl: string) =>
            handleGraphUpdate({
              index: singleGraphIndex,
              activeImage: imageUrl,
            })
          }
          onIdleTransparentChange={(value: boolean) =>
            handleGraphUpdate({
              index: singleGraphIndex,
              idleTransparent: value,
            })
          }
          onActiveTransparentChange={(value: boolean) =>
            handleGraphUpdate({
              index: singleGraphIndex,
              activeTransparent: value,
            })
          }
          onIdleImageFitChange={(fit: string) =>
            handleGraphUpdate({
              index: singleGraphIndex,
              idleImageFit: fit as ImageFit,
            })
          }
          onActiveImageFitChange={(fit: string) =>
            handleGraphUpdate({
              index: singleGraphIndex,
              activeImageFit: fit as ImageFit,
            })
          }
          onIdleImageReset={() =>
            handleGraphUpdate({
              index: singleGraphIndex,
              inactiveImage: '',
            })
          }
          onActiveImageReset={() =>
            handleGraphUpdate({
              index: singleGraphIndex,
              activeImage: '',
            })
          }
          onClose={() => setShowGraphImagePicker(false)}
        />
      )}
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
  handleToggleMode: () => void;
  handleTogglePanel: () => void;
  singleScrollRefFor: (tab: TabType) => (node: HTMLDivElement | null) => void;
  singleThumbRefFor: (tab: TabType) => (node: HTMLDivElement | null) => void;
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
  handleToggleMode,
  handleTogglePanel,
  singleScrollRefFor,
  singleThumbRefFor,
  panelElement,
  useCustomCSS,
  t,
}) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const imageButtonRef = useRef<HTMLButtonElement | null>(null);
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [classNameDraft, setClassNameDraft] = useState(
    singleKnobPosition.className || '',
  );

  useEffect(() => {
    setClassNameDraft(singleKnobPosition.className || '');
  }, [singleKnobIndex, selectedKeyType, singleKnobPosition.className]);

  // 회전 감지 바인딩: 노브를 돌리면 가장 많이 움직인 축을 자동 바인딩
  useEffect(() => {
    if (!capturing) return;
    axisEventBus.initialize();
    const counts = new Map<string, number>();
    let bound = false;
    const unsub = axisEventBus.subscribe(({ axisId }) => {
      if (bound) return;
      const c = (counts.get(axisId) ?? 0) + 1;
      counts.set(axisId, c);
      if (c >= 3) {
        bound = true;
        handleKnobUpdate({ index: singleKnobIndex, axisId });
        setCapturing(false);
      }
    });
    const timer = window.setTimeout(() => setCapturing(false), 6000);
    return () => {
      unsub();
      window.clearTimeout(timer);
    };
  }, [capturing, singleKnobIndex, handleKnobUpdate]);

  const setRef = (node: HTMLDivElement | null) => {
    panelRef.current = node;
    setPanelElement(node);
  };

  const knobTitle = singleKnobPosition.layerName || 'Knob';
  const axisLabel = singleKnobPosition.axisId
    ? singleKnobPosition.axisId.replace(/^HIDA:/, '')
    : t('propertiesPanel.knobAxisUnset') || '미지정';

  // 대기/입력 색상 (키 패널과 동일한 기본값/전환 로직)
  const DEFAULT_KNOB_BACKGROUND_COLOR = 'rgba(46, 46, 47, 0.9)';
  const DEFAULT_KNOB_BORDER_COLOR = 'rgba(113, 113, 113, 0.9)';
  const DEFAULT_KNOB_ACTIVE_BACKGROUND_COLOR = 'rgba(121, 121, 121, 0.9)';
  const DEFAULT_KNOB_ACTIVE_BORDER_COLOR = 'rgba(255, 255, 255, 0.9)';

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

  const handleColorChangeComplete = (
    target: KnobColorTarget,
    color: string,
  ) => {
    const prop = resolveColorProperty(target);
    setLocalColors((prev) => ({ ...prev, [prop]: color }));

    const updates: Partial<KnobItemPosition> = {
      [prop]: color,
    } as Partial<KnobItemPosition>;

    // idle 변경 시 active 값이 비어 있으면 현재 표시되던 active 값을 함께 저장
    // (active가 idle로 덮이는 현상 방지 — 키 패널과 동일)
    if (colorState !== 'active') {
      const activeProp = activeColorPropertyFor(target);
      const currentActive = singleKnobPosition[activeProp];
      if (!isNonEmptyString(currentActive)) {
        updates[activeProp] = localColors[activeProp];
      }
    }

    handleKnobUpdate({ index: singleKnobIndex, ...updates });
  };

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

  return (
    <div
      ref={setRef}
      className="absolute right-0 top-0 bottom-0 w-[220px] bg-glass backdrop-blur-[24px] shadow-elevation-panel flex flex-col z-30"
    >
      <div className="flex items-center justify-between p-[12px]">
        {isRenaming ? (
          <input
            ref={renameInputRef}
            type="text"
            className="text-fg text-style-2 bg-transparent border-none p-0 outline-none w-[130px] caret-accent"
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
              className="text-fg text-style-2 truncate max-w-[100px] cursor-default"
              onDoubleClick={handleRenameStart}
              title={knobTitle}
            >
              {knobTitle}
            </span>
            <button
              onClick={handleRenameStart}
              className="w-[18px] h-[18px] flex items-center justify-center text-fg-faint hover:text-fg hover:bg-surface-hover rounded-[4px] transition-colors flex-shrink-0"
              title={t('contextMenu.rename') || 'Rename'}
            >
              <RenameIcon />
            </button>
          </div>
        )}
        <div className="flex items-center gap-[4px]">
          <button
            onClick={handleToggleMode}
            className="w-[24px] h-[24px] flex items-center justify-center hover:bg-surface-hover rounded-[4px] transition-colors"
            title={t('propertiesPanel.switchToLayer') || 'Switch to Layer'}
          >
            <ModeToggleIcon mode="layer" />
          </button>
          <button
            onClick={handleTogglePanel}
            className="w-[24px] h-[24px] flex items-center justify-center hover:bg-surface-hover rounded-[4px] transition-colors"
            title={t('propertiesPanel.closePanel') || 'Close'}
          >
            <SidebarToggleIcon isOpen={true} />
          </button>
        </div>
      </div>

      <div className="flex-1 properties-panel-overlay-scroll">
        <div
          ref={singleScrollRefFor(TABS.STYLE)}
          className="properties-panel-overlay-viewport"
        >
          <div className="p-[12px] flex flex-col gap-[12px]">
            {/* 노브 매핑 (키 매핑과 동일한 라벨/버튼 구조) */}
            <PropertyRow label={t('propertiesPanel.knobAxis') || '노브 매핑'}>
              <button
                type="button"
                onClick={() => setCapturing((v) => !v)}
                className={`flex items-center justify-center h-[23px] min-w-[0px] px-[8px] bg-white/[0.07] hover:bg-white/[0.1] active:bg-white/[0.13] transition-colors duration-fast rounded-md ${
                  capturing ? 'shadow-focus-ring' : ''
                } text-fg text-style-2`}
                title={singleKnobPosition.axisId || ''}
              >
                <span className="truncate max-w-[120px]">
                  {capturing
                    ? t('propertiesPanel.knobCapturing') || '감지 중…'
                    : singleKnobPosition.axisId
                    ? axisLabel
                    : t('propertiesPanel.knobCapture') || '노브 돌려서 감지'}
                </span>
              </button>
            </PropertyRow>

            <SectionDivider />

            <PropertyRow label={t('propertiesPanel.position') || 'Position'}>
              <NumberInput
                value={Math.round(singleKnobPosition.dx || 0)}
                onChange={(value) =>
                  handleKnobUpdate({ index: singleKnobIndex, dx: value })
                }
                prefix="X"
                min={-9999}
                max={9999}
              />
              <NumberInput
                value={Math.round(singleKnobPosition.dy || 0)}
                onChange={(value) =>
                  handleKnobUpdate({ index: singleKnobIndex, dy: value })
                }
                prefix="Y"
                min={-9999}
                max={9999}
              />
            </PropertyRow>

            <PropertyRow label={t('propertiesPanel.size') || 'Size'}>
              <NumberInput
                value={Math.round(singleKnobPosition.width || 60)}
                onChange={(value) =>
                  handleKnobUpdate({
                    index: singleKnobIndex,
                    width: Math.max(20, value),
                  })
                }
                prefix="W"
                min={20}
                max={9999}
              />
              <NumberInput
                value={Math.round(singleKnobPosition.height || 60)}
                onChange={(value) =>
                  handleKnobUpdate({
                    index: singleKnobIndex,
                    height: Math.max(20, value),
                  })
                }
                prefix="H"
                min={20}
                max={9999}
              />
            </PropertyRow>

            <SectionDivider />

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

            <div className="flex justify-between items-center w-full h-[23px]">
              <p className="text-fg-muted text-label">
                {t('propertiesPanel.knobReverse') || '방향 반전'}
              </p>
              <Checkbox
                checked={singleKnobPosition.reverse ?? false}
                onChange={() =>
                  handleKnobUpdate({
                    index: singleKnobIndex,
                    reverse: !(singleKnobPosition.reverse ?? false),
                  })
                }
              />
            </div>

            <SectionDivider />

            {/* 배경색 (대기/입력 상태 전환은 피커 내부 토글) */}
            <PropertyRow
              label={t('propertiesPanel.backgroundColor') || '배경색'}
            >
              <button
                ref={bgColorBtnRef}
                type="button"
                onClick={() => handlePickerToggle('backgroundColor')}
                className={`w-[23px] h-[23px] rounded-md border-[1px] border-white/[0.12] overflow-hidden cursor-pointer transition-colors flex-shrink-0 ${
                  pickerFor === 'backgroundColor'
                    ? 'border-accent'
                    : 'border-line'
                }`}
                style={{ backgroundColor: colorValueFor('backgroundColor') }}
              />
            </PropertyRow>

            {/* 테두리 색상 */}
            <PropertyRow
              label={t('propertiesPanel.borderColor') || '테두리 색상'}
            >
              <button
                ref={borderColorBtnRef}
                type="button"
                onClick={() => handlePickerToggle('borderColor')}
                className={`w-[23px] h-[23px] rounded-md border-[1px] border-white/[0.12] overflow-hidden cursor-pointer transition-colors flex-shrink-0 ${
                  pickerFor === 'borderColor'
                    ? 'border-accent'
                    : 'border-line'
                }`}
                style={{ backgroundColor: colorValueFor('borderColor') }}
              />
            </PropertyRow>

            {/* 테두리 두께 */}
            <PropertyRow
              label={t('propertiesPanel.borderWidth') || '테두리 두께'}
            >
              <NumberInput
                value={singleKnobPosition.borderWidth ?? 3}
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
                className={`px-[8px] h-[23px] bg-white/[0.07] hover:bg-white/[0.1] active:bg-white/[0.13] transition-colors duration-fast rounded-md flex items-center justify-center ${
                  showImagePicker ? 'shadow-focus-ring' : ''
                } text-fg text-body`}
                onClick={() => setShowImagePicker(!showImagePicker)}
              >
                {t('propertiesPanel.configure') || 'Configure'}
              </button>
            </PropertyRow>

            {useCustomCSS && (
              <PropertyRow label={t('propertiesPanel.className') || '클래스'}>
                <TextInput
                  value={classNameDraft}
                  onChange={setClassNameDraft}
                  onBlur={() =>
                    handleKnobUpdate({
                      index: singleKnobIndex,
                      className: classNameDraft || '',
                    })
                  }
                  placeholder="className"
                  width="90px"
                />
              </PropertyRow>
            )}
          </div>
          <div className="properties-panel-overlay-bar">
            <div
              ref={singleThumbRefFor(TABS.STYLE)}
              className="properties-panel-overlay-thumb"
              style={{ display: 'none' }}
            />
          </div>
        </div>
      </div>

      {showImagePicker && imageButtonRef.current && (
        <ImagePicker
          open={showImagePicker}
          referenceRef={imageButtonRef}
          panelElement={panelRef.current}
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
            handleKnobUpdate({
              index: singleKnobIndex,
              inactiveImage: imageUrl,
            })
          }
          onActiveImageChange={(imageUrl: string) =>
            handleKnobUpdate({ index: singleKnobIndex, activeImage: imageUrl })
          }
          onIdleTransparentChange={(value: boolean) =>
            handleKnobUpdate({ index: singleKnobIndex, idleTransparent: value })
          }
          onActiveTransparentChange={(value: boolean) =>
            handleKnobUpdate({
              index: singleKnobIndex,
              activeTransparent: value,
            })
          }
          onIdleImageFitChange={(fit: string) =>
            handleKnobUpdate({
              index: singleKnobIndex,
              idleImageFit: fit as ImageFit,
            })
          }
          onActiveImageFitChange={(fit: string) =>
            handleKnobUpdate({
              index: singleKnobIndex,
              activeImageFit: fit as ImageFit,
            })
          }
          onIdleImageReset={() =>
            handleKnobUpdate({ index: singleKnobIndex, inactiveImage: '' })
          }
          onActiveImageReset={() =>
            handleKnobUpdate({ index: singleKnobIndex, activeImage: '' })
          }
          onClose={() => setShowImagePicker(false)}
        />
      )}

      {/* 대기/입력 색상 ColorPicker (키 패널과 동일한 stateMode 토글) */}
      {pickerFor && (
        <ColorPicker
          open={!!pickerFor}
          referenceRef={
            pickerFor === 'backgroundColor' ? bgColorBtnRef : borderColorBtnRef
          }
          panelElement={panelElement}
          color={colorValueFor(pickerFor)}
          onColorChange={(c: string) => handleColorChange(pickerFor, c)}
          onColorChangeComplete={(c: string) =>
            handleColorChangeComplete(pickerFor, c)
          }
          onClose={() => setPickerFor(null)}
          solidOnly={true}
          stateMode={colorState}
          onStateModeChange={setColorState}
          interactiveRefs={[bgColorBtnRef, borderColorBtnRef]}
        />
      )}
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
  handleToggleMode: () => void;
  handleTogglePanel: () => void;
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  onPositionChange: (index: number, dx: number, dy: number) => void;
  onKeyUpdate: (data: Partial<KeyPosition> & { index: number }) => void;
  onKeyPreview?: (index: number, updates: Partial<KeyPosition>) => void;
  onKeyMappingChange?: (index: number, newKey: string) => void;
  handleStatUpdate: (
    data: Partial<StatItemPosition> & { index: number },
  ) => void;
  handleStatPreview: (
    index: number,
    updates: Partial<StatItemPosition>,
  ) => void;
  isListening: boolean;
  handleKeyListen: () => void;
  localState: Partial<KeyPosition> & { dx?: number; dy?: number };
  setLocalState: React.Dispatch<
    React.SetStateAction<Partial<KeyPosition> & { dx?: number; dy?: number }>
  >;
  handleSizeBlur: () => void;
  showImagePicker: boolean;
  setShowImagePicker: (value: boolean) => void;
  imageButtonRef: React.RefObject<HTMLButtonElement | null>;
  panelElement: HTMLDivElement | null;
  useCustomCSS: boolean;
  singleScrollRefFor: (tab: TabType) => (node: HTMLDivElement | null) => void;
  singleThumbRefFor: (tab: TabType) => (node: HTMLDivElement | null) => void;
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
  handleToggleMode,
  handleTogglePanel,
  activeTab,
  setActiveTab,
  onPositionChange,
  onKeyUpdate,
  onKeyPreview,
  onKeyMappingChange,
  handleStatUpdate,
  handleStatPreview,
  isListening,
  handleKeyListen,
  localState,
  setLocalState,
  handleSizeBlur,
  showImagePicker,
  setShowImagePicker,
  imageButtonRef,
  panelElement,
  useCustomCSS,
  singleScrollRefFor,
  singleThumbRefFor,
  t,
}) => {
  const availableTabs = isSingleStat
    ? [TABS.STYLE, TABS.COUNTER]
    : [TABS.STYLE, TABS.NOTE, TABS.COUNTER];

  const statBaseOptions = [
    { label: 'KPS', value: 'kps' },
    { label: 'Total', value: 'total' },
  ];

  const statKpsOptions = [
    { label: 'KPS', value: 'kps' },
    { label: 'AVG', value: 'kpsAvg' },
    { label: 'MAX', value: 'kpsMax' },
  ];

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
          options={statBaseOptions}
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
            options={statKpsOptions}
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
    <div
      ref={setPanelElement}
      className="absolute right-0 top-0 bottom-0 w-[220px] bg-glass backdrop-blur-[24px] shadow-elevation-panel flex flex-col z-30"
    >
      {/* 헤더 + 탭 영역 */}
      <div className="flex-shrink-0">
        {/* 헤더 */}
        <div className="flex items-center justify-between p-[12px] pb-[8px]">
          {isRenaming ? (
            <input
              ref={renameInputRef}
              type="text"
              className="text-fg text-style-2 bg-transparent border-none p-0 outline-none w-[130px] caret-accent"
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
                className="text-fg text-style-2 cursor-default truncate max-w-[110px]"
                onDoubleClick={handleRenameStart}
                title={keyLikeTitle}
              >
                {keyLikeTitle}
              </span>
              <button
                onClick={handleRenameStart}
                className="w-[18px] h-[18px] flex items-center justify-center text-fg-faint hover:text-fg hover:bg-surface-hover rounded-[4px] transition-colors flex-shrink-0"
                title={t('contextMenu.rename') || 'Rename'}
              >
                <RenameIcon />
              </button>
            </div>
          )}

          <div className="flex items-center gap-[4px]">
            {/* 레이어 모드로 전환 버튼 */}
            <button
              onClick={handleToggleMode}
              className="w-[24px] h-[24px] flex items-center justify-center hover:bg-surface-hover rounded-[4px] transition-colors"
              title={t('propertiesPanel.switchToLayer') || 'Switch to Layer'}
            >
              <ModeToggleIcon mode="layer" />
            </button>
            {/* 패널 닫기 버튼 */}
            <button
              onClick={handleTogglePanel}
              className="w-[24px] h-[24px] flex items-center justify-center hover:bg-surface-hover rounded-[4px] transition-colors"
              title={t('propertiesPanel.closePanel') || '속성 패널 닫기'}
            >
              <SidebarToggleIcon isOpen={true} />
            </button>
          </div>
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
          <div className="p-[12px] flex flex-col gap-[12px]">
            <StyleTabContent
              keyIndex={keyLikeIndex}
              keyPosition={keyLikePosition}
              keyCode={keyLikeCode}
              keyInfo={keyLikeInfo}
              onPositionChange={handleKeyLikePositionChange}
              onKeyUpdate={handleKeyLikeUpdate}
              onKeyPreview={handleKeyLikePreview}
              onKeyMappingChange={isSingleStat ? undefined : onKeyMappingChange}
              isListening={isListening}
              onKeyListen={isSingleStat ? undefined : handleKeyListen}
              mappingControlLayout={mappingControlLayout}
              mappingLabel={
                isSingleStat
                  ? t('propertiesPanel.statType') || 'Stat Type'
                  : undefined
              }
              showSoundControls={!isSingleStat}
              showImagePicker={showImagePicker}
              onToggleImagePicker={() => setShowImagePicker(!showImagePicker)}
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
            />
          </div>
          <div className="properties-panel-overlay-bar">
            <div
              ref={singleThumbRefFor(TABS.STYLE)}
              className="properties-panel-overlay-thumb"
              style={{ display: 'none' }}
            />
          </div>
        </div>

        {/* NOTE 탭 viewport */}
        {!isSingleStat && (
          <div
            ref={singleScrollRefFor(TABS.NOTE)}
            className={`properties-panel-overlay-viewport ${
              activeTab === TABS.NOTE ? '' : 'hidden'
            }`}
          >
            <div className="p-[12px] flex flex-col gap-[12px]">
              <NoteTabContent
                keyIndex={singleKeyIndex!}
                keyPosition={singleKeyPosition!}
                onKeyUpdate={onKeyUpdate}
                onKeyPreview={onKeyPreview}
                panelElement={panelElement}
                t={t}
              />
            </div>
            <div className="properties-panel-overlay-bar">
              <div
                ref={singleThumbRefFor(TABS.NOTE)}
                className="properties-panel-overlay-thumb"
                style={{ display: 'none' }}
              />
            </div>
          </div>
        )}

        {/* COUNTER 탭 viewport */}
        <div
          ref={singleScrollRefFor(TABS.COUNTER)}
          className={`properties-panel-overlay-viewport ${
            activeTab === TABS.COUNTER ? '' : 'hidden'
          }`}
        >
          <div className="p-[12px] flex flex-col gap-[12px]">
            <CounterTabContent
              keyIndex={keyLikeIndex}
              keyPosition={keyLikePosition}
              keyDisplayName={keyLikeInfo?.displayName}
              isStat={isSingleStat}
              onKeyUpdate={handleKeyLikeUpdate}
              panelElement={panelElement}
              t={t}
            />
          </div>
          <div className="properties-panel-overlay-bar">
            <div
              ref={singleThumbRefFor(TABS.COUNTER)}
              className="properties-panel-overlay-thumb"
              style={{ display: 'none' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
