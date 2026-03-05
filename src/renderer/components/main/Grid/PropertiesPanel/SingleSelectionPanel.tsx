/* eslint-disable react-hooks/refs */
import React from 'react';
import type { KeyPosition } from '@src/types/keys';
import type { StatItemPosition, StatItemType } from '@src/types/statItems';
import type { GraphItemPosition } from '@src/types/graphItems';
import type { PluginSettingSchema, PluginMessages } from '@src/types/api';
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
} from './index';
import Checkbox from '@components/main/common/Checkbox';
import Dropdown from '@components/main/common/Dropdown';
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
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 20H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M16.5 3.5C17.3284 2.67157 18.6716 2.67157 19.5 3.5V3.5C20.3284 4.32843 20.3284 5.67157 19.5 6.5L7 19L3 20L4 16L16.5 3.5Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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
  selectedPluginElement: any;
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
    values: Record<string, any>,
    messages: PluginMessages | undefined,
    colorIdPrefix: string,
    onChange: (key: string, value: any) => void,
    options?: { wrap?: boolean },
  ) => React.ReactNode;
  selectedPluginDefinition: any;
  resolvedPluginSettings: Record<string, any>;
  handlePluginSettingChange: (key: string, value: any) => void;
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
      className="absolute right-0 top-0 bottom-0 w-[220px] bg-[#1F1F24] border-l border-[#3A3943] flex flex-col z-30 shadow-lg"
    >
      <div className="flex items-center justify-between p-[12px] border-b border-[#3A3943]">
        <span className="text-[#DBDEE8] text-style-2 truncate max-w-[120px]">
          {pluginTitle}
        </span>
        <div className="flex items-center gap-[4px]">
          <button
            onClick={handleToggleMode}
            className="w-[24px] h-[24px] flex items-center justify-center hover:bg-[#2A2A30] rounded-[4px] transition-colors"
            title={t('propertiesPanel.switchToLayer') || 'Switch to Layer'}
          >
            <ModeToggleIcon mode="layer" />
          </button>
          <button
            onClick={handleTogglePanel}
            className="w-[24px] h-[24px] flex items-center justify-center hover:bg-[#2A2A30] rounded-[4px] transition-colors"
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
              <p className="text-[#6B6D75] text-style-4 text-center">
                {t('propertiesPanel.pluginMultiSelection') ||
                  '플러그인 요소는 한 번에 하나만 편집할 수 있습니다.'}
              </p>
            )}
            {hasSinglePluginSelection && showModalHint && (
              <p className="text-[#6B6D75] text-style-4 text-center">
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
  handleGraphUpdate: (data: Partial<GraphItemPosition> & { index: number }) => void;
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
  const graphTitle =
    (singleGraphPosition as any).layerName || graphDefaultTitle;

  return (
    <div
      ref={setPanelElement}
      className="absolute right-0 top-0 bottom-0 w-[220px] bg-[#1F1F24] border-l border-[#3A3943] flex flex-col z-30 shadow-lg"
    >
      <div className="flex items-center justify-between p-[12px] border-b border-[#3A3943]">
        {isRenaming ? (
          <input
            ref={renameInputRef}
            type="text"
            className="text-[#DBDEE8] text-style-2 bg-transparent border-none p-0 outline-none w-[130px] caret-[#3B82F6]"
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
              className="text-[#DBDEE8] text-style-2 truncate max-w-[100px] cursor-default"
              onDoubleClick={handleRenameStart}
              title={graphTitle}
            >
              {graphTitle}
            </span>
            <button
              onClick={handleRenameStart}
              className="w-[18px] h-[18px] flex items-center justify-center text-[#6B6D75] hover:text-[#DBDEE8] hover:bg-[#2A2A30] rounded-[4px] transition-colors flex-shrink-0"
              title={t('contextMenu.rename') || 'Rename'}
            >
              <RenameIcon />
            </button>
          </div>
        )}
        <div className="flex items-center gap-[4px]">
          <button
            onClick={handleToggleMode}
            className="w-[24px] h-[24px] flex items-center justify-center hover:bg-[#2A2A30] rounded-[4px] transition-colors"
            title={t('propertiesPanel.switchToLayer') || 'Switch to Layer'}
          >
            <ModeToggleIcon mode="layer" />
          </button>
          <button
            onClick={handleTogglePanel}
            className="w-[24px] h-[24px] flex items-center justify-center hover:bg-[#2A2A30] rounded-[4px] transition-colors"
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
                  } as any)
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
                  } as any)
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
                  } as any)
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
                  } as any)
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
                    graphType: value as any,
                  } as any)
                }
              />
            </PropertyRow>

            {(singleGraphPosition.graphType || 'line') === 'line' && (
              <div className="flex justify-between items-center w-full h-[23px]">
                <p className="text-white text-style-2">
                  {t('propertiesPanel.graphShowAverageLine') ||
                    'Show Average Line'}
                </p>
                <Checkbox
                  checked={singleGraphPosition.showAvgLine ?? true}
                  onChange={() =>
                    handleGraphUpdate({
                      index: singleGraphIndex,
                      showAvgLine: !(singleGraphPosition.showAvgLine ?? true),
                    } as any)
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
                  } as any);
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
                  } as any)
                }
                colorId={`graph-color-${selectedKeyType}-${singleGraphIndex}`}
                panelElement={panelElement}
              />
            </PropertyRow>

            <div className="flex justify-between items-center w-full h-[23px]">
              <p className="text-white text-style-2">
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
                  } as any)
                }
              />
            </div>

            <SectionDivider />

            <PropertyRow
              label={
                t('propertiesPanel.backgroundColor') || 'Background Color'
              }
            >
              <ColorInput
                value={
                  singleGraphPosition.backgroundColor ||
                  'rgba(17, 17, 20, 0.9)'
                }
                onChange={() => {}}
                onChangeComplete={(value) =>
                  handleGraphUpdate({
                    index: singleGraphIndex,
                    backgroundColor: value,
                  } as any)
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
                  singleGraphPosition.borderColor ||
                  'rgba(255, 255, 255, 0.1)'
                }
                onChange={() => {}}
                onChangeComplete={(value) =>
                  handleGraphUpdate({
                    index: singleGraphIndex,
                    borderColor: value,
                  } as any)
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
                  } as any)
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
                  } as any)
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
                className={`px-[7px] h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] flex items-center justify-center ${
                  showGraphImagePicker
                    ? 'border-[#459BF8]'
                    : 'border-[#3A3943]'
                } text-[#DBDEE8] text-style-4`}
                onClick={() => setShowGraphImagePicker(!showGraphImagePicker)}
              >
                {t('propertiesPanel.configure') || 'Configure'}
              </button>
            </PropertyRow>

            {useCustomCSS && (
              <>
                <SectionDivider />

                <div className="flex justify-between items-center w-full h-[23px]">
                  <p className="text-white text-style-2">
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
                      } as any)
                    }
                  />
                </div>

                <PropertyRow
                  label={t('propertiesPanel.className') || '클래스'}
                >
                  <TextInput
                    value={graphClassNameDraft}
                    onChange={setGraphClassNameDraft}
                    onBlur={() =>
                      handleGraphUpdate({
                        index: singleGraphIndex,
                        className: graphClassNameDraft || '',
                      } as any)
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
            } as any)
          }
          onActiveImageChange={(imageUrl: string) =>
            handleGraphUpdate({
              index: singleGraphIndex,
              activeImage: imageUrl,
            } as any)
          }
          onIdleTransparentChange={(value: boolean) =>
            handleGraphUpdate({
              index: singleGraphIndex,
              idleTransparent: value,
            } as any)
          }
          onActiveTransparentChange={(value: boolean) =>
            handleGraphUpdate({
              index: singleGraphIndex,
              activeTransparent: value,
            } as any)
          }
          onIdleImageFitChange={(fit: any) =>
            handleGraphUpdate({
              index: singleGraphIndex,
              idleImageFit: fit,
            } as any)
          }
          onActiveImageFitChange={(fit: any) =>
            handleGraphUpdate({
              index: singleGraphIndex,
              activeImageFit: fit,
            } as any)
          }
          onIdleImageReset={() =>
            handleGraphUpdate({
              index: singleGraphIndex,
              inactiveImage: '',
            } as any)
          }
          onActiveImageReset={() =>
            handleGraphUpdate({
              index: singleGraphIndex,
              activeImage: '',
            } as any)
          }
          onClose={() => setShowGraphImagePicker(false)}
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
  singleKeyInfo: any;
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
  handleStatUpdate: (data: Partial<StatItemPosition> & { index: number }) => void;
  handleStatPreview: (index: number, updates: Partial<StatItemPosition>) => void;
  isListening: boolean;
  handleKeyListen: () => void;
  localState: Partial<KeyPosition> & { dx?: number; dy?: number };
  setLocalState: React.Dispatch<React.SetStateAction<Partial<KeyPosition> & { dx?: number; dy?: number }>>;
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
  const keyLikePosition = (
    isSingleStat ? singleStatPosition! : singleKeyPosition!
  ) as any;

  const keyLikeDefaultTitle = isSingleStat
    ? statTitle
    : singleKeyInfo?.displayName || singleKeyCode || 'Key';
  const keyLikeTitle = keyLikePosition?.layerName || keyLikeDefaultTitle;

  const keyLikeCode = isSingleStat ? null : singleKeyCode;
  const keyLikeInfo = isSingleStat
    ? ({
        browserKey: statTitle,
        globalKey: statTitle,
        displayName: statTitle,
      } as any)
    : singleKeyInfo;

  const handleKeyLikePositionChange = isSingleStat
    ? (index: number, dx: number, dy: number) =>
        handleStatUpdate({ index, dx, dy } as any)
    : onPositionChange;

  const handleKeyLikeUpdate = isSingleStat
    ? (data: Partial<KeyPosition> & { index: number }) =>
        handleStatUpdate(data as any)
    : onKeyUpdate;

  const handleKeyLikePreview = isSingleStat
    ? (index: number, updates: Partial<KeyPosition>) =>
        handleStatPreview(index, updates as any)
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
      className="absolute right-0 top-0 bottom-0 w-[220px] bg-[#1F1F24] border-l border-[#3A3943] flex flex-col z-30 shadow-lg"
    >
      {/* 헤더 + 탭 영역 */}
      <div className="flex-shrink-0 border-b border-[#3A3943]">
        {/* 헤더 */}
        <div className="flex items-center justify-between p-[12px] pb-[8px]">
          {isRenaming ? (
            <input
              ref={renameInputRef}
              type="text"
              className="text-[#DBDEE8] text-style-2 bg-transparent border-none p-0 outline-none w-[130px] caret-[#3B82F6]"
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
                className="text-[#DBDEE8] text-style-2 cursor-default truncate max-w-[110px]"
                onDoubleClick={handleRenameStart}
                title={keyLikeTitle}
              >
                {keyLikeTitle}
              </span>
              <button
                onClick={handleRenameStart}
                className="w-[18px] h-[18px] flex items-center justify-center text-[#6B6D75] hover:text-[#DBDEE8] hover:bg-[#2A2A30] rounded-[4px] transition-colors flex-shrink-0"
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
              className="w-[24px] h-[24px] flex items-center justify-center hover:bg-[#2A2A30] rounded-[4px] transition-colors"
              title={t('propertiesPanel.switchToLayer') || 'Switch to Layer'}
            >
              <ModeToggleIcon mode="layer" />
            </button>
            {/* 패널 닫기 버튼 */}
            <button
              onClick={handleTogglePanel}
              className="w-[24px] h-[24px] flex items-center justify-center hover:bg-[#2A2A30] rounded-[4px] transition-colors"
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
