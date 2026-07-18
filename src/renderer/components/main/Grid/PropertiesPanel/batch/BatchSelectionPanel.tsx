/* eslint-disable react-hooks/refs */
import React from 'react';
import type {
  KeyPosition,
  NoteColor,
  KeyCounterSettings,
} from '@src/types/key/keys';
import type {
  GraphItemPosition,
  GraphItemType,
} from '@src/types/key/graphItems';
import type { KnobItemPosition } from '@src/types/key/knobs';
import type { ColorModeValue } from '@src/types/color';
import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import { PANEL_ROOT_CLASS, PANEL_HEADER_CLASS } from '../panelChrome';
import {
  normalizeCounterSettings,
  createDefaultCounterSettings,
} from '@src/types/key/keys';
import {
  PropertyRow,
  NumberInput,
  ColorInput,
  Tabs,
  BatchStyleTabContent,
  BatchNoteTabContent,
  BatchCounterTabContent,
  TABS,
  TabType,
} from '../index';
import Checkbox from '@components/main/common/Checkbox';
import Dropdown from '@components/main/common/Dropdown';
import ColorPicker from '@components/main/Modal/content/pickers/ColorPicker';
import ImagePicker from '@components/main/Modal/content/pickers/ImagePicker';

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
// Mixed key-like + graph batch selection panel
// ============================================================================

type BatchPickerTarget =
  | 'noteColor'
  | 'glowColor'
  | 'borderColor'
  | 'fill'
  | 'stroke'
  | null;

type MixedValueResult<T> = { isMixed: boolean; value: T };
type MixedValueGetter<P> = <T>(
  getter: (pos: P) => T | undefined,
  defaultValue: T,
) => MixedValueResult<T>;

interface KeyData {
  index: number;
  position: KeyPosition | undefined;
  keyCode: string | null;
  keyInfo: { globalKey: string; displayName: string } | null;
}

interface BatchLocalColors {
  noteColor: NoteColor;
  glowColor: NoteColor;
  borderColor: string;
  borderOpacity: number;
  fillIdle: string;
  fillActive: string;
  strokeIdle: string;
  strokeActive: string;
}

interface BatchKeyLikePanelProps {
  setPanelElement: (el: HTMLDivElement | null) => void;
  selectedBatchStyleElements: SelectedElement[];
  selectedKeyElements: SelectedElement[];
  selectedStatElements: SelectedElement[];
  selectedGraphElements: SelectedElement[];
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
    options?: { skipHistory?: boolean },
  ) => void;
  handleBatchSpacingPreview: (spacing: number) => void;
  handleBatchSpacingCommit: (
    spacing: number,
    options?: { skipHistory?: boolean },
  ) => void;
  getBatchSpacingValue: () => MixedValueResult<number>;
  handleBatchResize: (dimension: 'width' | 'height', value: number) => void;
  handleBatchStyleChange: (property: keyof KeyPosition, value: unknown) => void;
  handleBatchStyleChangeComplete: (
    property: keyof KeyPosition,
    value: unknown,
  ) => void;
  handleBatchGradientCommit?: (
    target: 'backgroundColor' | 'borderColor',
    state: 'idle' | 'active',
    value: ColorModeValue,
  ) => void;
  handleKeyOnlyStyleChangeComplete: (
    property: keyof KeyPosition,
    value: KeyPosition[keyof KeyPosition],
  ) => void;
  handleBatchCounterUpdate: (updates: Partial<KeyCounterSettings>) => void;
  handleBatchNoteColorChange: (value: NoteColor) => void;
  handleBatchNoteColorChangeComplete: (value: NoteColor) => void;
  handleBatchGlowColorChange: (value: NoteColor) => void;
  handleBatchGlowColorChangeComplete: (value: NoteColor) => void;
  handleGraphBatchSharedSetting: (updates: Partial<GraphItemPosition>) => void;
  // mixed value getters
  getMixedValue: MixedValueGetter<KeyPosition>;
  getMixedValueBatch: MixedValueGetter<KeyPosition>;
  getMixedValueGraphs: MixedValueGetter<GraphItemPosition>;
  getMixedValueGraphsAsKey: MixedValueGetter<KeyPosition>;
  getMixedValueKeysOnly: MixedValueGetter<KeyPosition>;
  getSelectedKeysData: () => KeyData[];
  getSelectedGraphsData: () => KeyData[];
  getSelectedBatchStyleData: () => KeyData[];
  getSelectedKeyOnlyPositions: () => { index: number; position: KeyPosition }[];
  // batch key-only handlers
  handleBatchKeyOnlyStyleChangeComplete: (
    property: keyof KeyPosition,
    value: KeyPosition[keyof KeyPosition],
  ) => void;
  handleBatchNoteColorChangeKeysOnly: (value: NoteColor) => void;
  handleBatchNoteColorChangeCompleteKeysOnly: (value: NoteColor) => void;
  handleBatchGlowColorChangeKeysOnly: (value: NoteColor) => void;
  handleBatchGlowColorChangeCompleteKeysOnly: (value: NoteColor) => void;
  // refs
  batchScrollRefFor: (tab: TabType) => (node: HTMLDivElement | null) => void;
  batchNoteColorButtonRef: React.RefObject<HTMLButtonElement | null>;
  batchGlowColorButtonRef: React.RefObject<HTMLButtonElement | null>;
  batchBorderColorButtonRef: React.RefObject<HTMLButtonElement | null>;
  batchCounterFillButtonRef: React.RefObject<HTMLButtonElement | null>;
  batchCounterStrokeButtonRef: React.RefObject<HTMLButtonElement | null>;
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
  batchLocalOpacities: { noteOpacity: number; glowOpacity: number };
  setBatchLocalOpacities: React.Dispatch<
    React.SetStateAction<{ noteOpacity: number; glowOpacity: number }>
  >;
  handleBatchPickerToggle: (target: BatchPickerTarget) => void;
  handleBatchPickerColorChange: (newColor: NoteColor) => void;
  handleBatchPickerColorChangeComplete: (newColor: NoteColor) => void;
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
  selectedBatchStyleElements,
  selectedKeyElements,
  selectedStatElements: _selectedStatElements,
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
  handleBatchStyleChange,
  handleBatchStyleChangeComplete,
  handleBatchGradientCommit,
  handleKeyOnlyStyleChangeComplete,
  handleBatchCounterUpdate,
  handleGraphBatchSharedSetting,
  getMixedValue,
  getMixedValueBatch,
  getMixedValueGraphs,
  getMixedValueKeysOnly,
  getSelectedKeysData,
  getSelectedGraphsData,
  getSelectedBatchStyleData,
  getSelectedKeyOnlyPositions: _getSelectedKeyOnlyPositions,
  handleBatchKeyOnlyStyleChangeComplete,
  handleBatchNoteColorChangeKeysOnly: _handleBatchNoteColorChangeKeysOnly,
  handleBatchNoteColorChangeCompleteKeysOnly:
    _handleBatchNoteColorChangeCompleteKeysOnly,
  handleBatchGlowColorChangeKeysOnly: _handleBatchGlowColorChangeKeysOnly,
  handleBatchGlowColorChangeCompleteKeysOnly:
    _handleBatchGlowColorChangeCompleteKeysOnly,
  handleBatchNoteColorChange: _handleBatchNoteColorChange,
  handleBatchNoteColorChangeComplete: _handleBatchNoteColorChangeComplete,
  handleBatchGlowColorChange: _handleBatchGlowColorChange,
  handleBatchGlowColorChangeComplete: _handleBatchGlowColorChangeComplete,
  batchScrollRefFor,
  batchNoteColorButtonRef,
  batchGlowColorButtonRef,
  batchBorderColorButtonRef,
  batchCounterFillButtonRef,
  batchCounterStrokeButtonRef,
  batchImageButtonRef,
  showBatchImagePicker,
  setShowBatchImagePicker,
  batchPickerFor,
  setBatchPickerFor,
  batchCounterColorState,
  setBatchCounterColorState,
  batchLocalColors,
  setBatchLocalColors: _setBatchLocalColors,
  batchLocalOpacities,
  setBatchLocalOpacities,
  handleBatchPickerToggle,
  handleBatchPickerColorChange,
  handleBatchPickerColorChangeComplete,
  getBatchPickerColor,
  getBatchPickerRef,
  batchColorPickerInteractiveRefs,
  panelElement,
  useCustomCSS,
  selectedKeyType,
  t,
}) => {
  const hasGraphSelection = selectedGraphElements.length > 0;
  const styleMixedValueGetter = hasGraphSelection
    ? getMixedValueBatch
    : getMixedValue;
  const styleSelectedDataGetter = hasGraphSelection
    ? getSelectedBatchStyleData
    : getSelectedKeysData;

  // opacity가 mixed면 첫 항목 값을 공통값처럼 단언하지 않고 원색으로 표시
  const opacityOrFull = (mixed: { isMixed: boolean; value: number }) =>
    mixed.isMixed ? 1 : mixed.value / 100;

  const getBatchNoteColorDisplay = () => {
    if (batchPickerFor === 'noteColor') {
      const value = batchLocalColors.noteColor;
      if (
        value &&
        typeof value === 'object' &&
        'type' in value &&
        value.type === 'gradient'
      ) {
        return {
          color: undefined,
          gradient: { top: value.top, bottom: value.bottom },
          opacity: batchLocalOpacities.noteOpacity / 100,
          label: 'Gradient',
          isMixed: false,
        };
      }
      const color = typeof value === 'string' ? value : '#FFFFFF';
      return {
        color,
        gradient: undefined,
        opacity: batchLocalOpacities.noteOpacity / 100,
        label: color.replace(/^#/, ''),
        isMixed: false,
      };
    }

    const mixedFn =
      selectedKeyElements.length > 0 ? getMixedValueKeysOnly : getMixedValue;
    const { isMixed, value } = mixedFn(
      (pos) => pos.noteColor,
      '#FFFFFF' as NoteColor,
    );
    if (isMixed)
      return {
        color: '#666',
        gradient: undefined,
        opacity: 1,
        label: 'Mixed',
        isMixed: true,
      };
    const opacity = opacityOrFull(mixedFn((pos) => pos.noteOpacity, 80));
    if (
      value &&
      typeof value === 'object' &&
      'type' in value &&
      value.type === 'gradient'
    ) {
      return {
        color: undefined,
        gradient: { top: value.top, bottom: value.bottom },
        opacity: {
          top: opacityOrFull(
            mixedFn((pos) => pos.noteOpacityTop ?? pos.noteOpacity, 80),
          ),
          bottom: opacityOrFull(
            mixedFn((pos) => pos.noteOpacityBottom ?? pos.noteOpacity, 80),
          ),
        },
        label: 'Gradient',
        isMixed: false,
      };
    }
    const color = typeof value === 'string' ? value : '#FFFFFF';
    return {
      color,
      gradient: undefined,
      opacity,
      label: color.replace(/^#/, ''),
      isMixed: false,
    };
  };

  const getBatchGlowColorDisplay = () => {
    if (batchPickerFor === 'glowColor') {
      const value = batchLocalColors.glowColor;
      if (
        value &&
        typeof value === 'object' &&
        'type' in value &&
        value.type === 'gradient'
      ) {
        return {
          color: undefined,
          gradient: { top: value.top, bottom: value.bottom },
          opacity: batchLocalOpacities.glowOpacity / 100,
          label: 'Gradient',
          isMixed: false,
        };
      }
      const color = typeof value === 'string' ? value : '#FFFFFF';
      return {
        color,
        gradient: undefined,
        opacity: batchLocalOpacities.glowOpacity / 100,
        label: color.replace(/^#/, ''),
        isMixed: false,
      };
    }

    const mixedFn =
      selectedKeyElements.length > 0 ? getMixedValueKeysOnly : getMixedValue;
    const { isMixed, value } = mixedFn(
      (pos) => pos.noteGlowColor ?? pos.noteColor,
      '#FFFFFF' as NoteColor,
    );
    if (isMixed)
      return {
        color: '#666',
        gradient: undefined,
        opacity: 1,
        label: 'Mixed',
        isMixed: true,
      };
    const opacity = opacityOrFull(mixedFn((pos) => pos.noteGlowOpacity, 70));
    if (
      value &&
      typeof value === 'object' &&
      'type' in value &&
      value.type === 'gradient'
    ) {
      return {
        color: undefined,
        gradient: { top: value.top, bottom: value.bottom },
        opacity: {
          top: opacityOrFull(
            mixedFn((pos) => pos.noteGlowOpacityTop ?? pos.noteGlowOpacity, 70),
          ),
          bottom: opacityOrFull(
            mixedFn(
              (pos) => pos.noteGlowOpacityBottom ?? pos.noteGlowOpacity,
              70,
            ),
          ),
        },
        label: 'Gradient',
        isMixed: false,
      };
    }
    const color = typeof value === 'string' ? value : '#FFFFFF';
    return {
      color,
      gradient: undefined,
      opacity,
      label: color.replace(/^#/, ''),
      isMixed: false,
    };
  };

  // 테두리 색은 단색만 지원. 피커 열림 시 로컬값, 닫힘 시 실제 공통값/Mixed 표시
  const getBatchBorderColorDisplay = () => {
    if (batchPickerFor === 'borderColor') {
      const color = batchLocalColors.borderColor;
      return {
        color,
        gradient: undefined,
        opacity: batchLocalColors.borderOpacity / 100,
        label: color.replace(/^#/, ''),
        isMixed: false,
      };
    }

    const mixedFn =
      selectedKeyElements.length > 0 ? getMixedValueKeysOnly : getMixedValue;
    const { isMixed, value } = mixedFn((pos) => pos.noteBorderColor, '#FFFFFF');
    if (isMixed)
      return {
        color: '#666',
        gradient: undefined,
        opacity: 1,
        label: 'Mixed',
        isMixed: true,
      };
    const color = typeof value === 'string' ? value : '#FFFFFF';
    return {
      color,
      gradient: undefined,
      opacity: opacityOrFull(mixedFn((pos) => pos.noteBorderOpacity, 100)),
      label: color.replace(/^#/, ''),
      isMixed: false,
    };
  };

  const keysData = getSelectedKeysData();
  const batchCounterSettings = keysData[0]?.position
    ? normalizeCounterSettings(keysData[0].position.counter)
    : createDefaultCounterSettings();
  const firstPos = keysData[0]?.position;
  const batchKeyVisual = firstPos
    ? {
        width: firstPos.width,
        height: firstPos.height,
        backgroundColor: firstPos.backgroundColor,
        borderColor: firstPos.borderColor,
        borderWidth: firstPos.borderWidth,
        borderRadius: firstPos.borderRadius,
        fontColor: firstPos.fontColor,
        fontSize: firstPos.fontSize,
        fontWeight: firstPos.fontWeight,
        fontFamily: firstPos.fontFamily,
        fontItalic: firstPos.fontItalic,
        fontUnderline: firstPos.fontUnderline,
        fontStrikethrough: firstPos.fontStrikethrough,
        displayText: firstPos.displayText,
        displayName: keysData[0]?.keyInfo?.displayName,
        className: firstPos.className,
        activeBackgroundColor: firstPos.activeBackgroundColor,
        activeBorderColor: firstPos.activeBorderColor,
        activeFontColor: firstPos.activeFontColor,
        useInlineStyles: firstPos.useInlineStyles,
        isStat: selectedKeyLikeElements[0]?.type === 'stat',
      }
    : undefined;
  const noteOpacityMixed = getMixedValue((pos) => pos.noteOpacity, 80).isMixed;
  const glowOpacityMixed = getMixedValue(
    (pos) => pos.noteGlowOpacity,
    70,
  ).isMixed;
  const batchSpacing = getBatchSpacingValue();
  const graphTypeState = getMixedValueGraphs(
    (pos) => pos.graphType || 'line',
    'line' as string,
  );
  const showAvgLineState = getMixedValueGraphs(
    (pos) => pos.showAvgLine ?? true,
    true,
  );
  const graphSpeedState = getMixedValueGraphs(
    (pos) => Math.round(pos.graphSpeed || 1000),
    1000,
  );
  const graphColorState = getMixedValueGraphs(
    (pos) => pos.graphColor || '#86EFAC',
    '#86EFAC',
  );
  const graphAnimationState = getMixedValueGraphs(
    (pos) => pos.graphAnimationEnabled ?? true,
    true,
  );
  const hasLineGraph = getSelectedGraphsData().some(
    (data) =>
      ((data.position as GraphItemPosition | undefined)?.graphType ||
        'line') === 'line',
  );
  const graphShapeOptions = [
    { label: t('propertiesPanel.graphShapeLine') || 'Line', value: 'line' },
    { label: t('propertiesPanel.graphShapeBar') || 'Bar', value: 'bar' },
  ];

  const getCounterColorDisplay = (target: 'fill' | 'stroke') => {
    const key =
      target === 'fill'
        ? batchCounterColorState === 'active'
          ? 'fillActive'
          : 'fillIdle'
        : batchCounterColorState === 'active'
        ? 'strokeActive'
        : 'strokeIdle';

    if (batchPickerFor === target) {
      return batchLocalColors[key];
    }

    return target === 'fill'
      ? batchCounterColorState === 'active'
        ? batchCounterSettings.fill.active
        : batchCounterSettings.fill.idle
      : batchCounterColorState === 'active'
      ? batchCounterSettings.stroke.active
      : batchCounterSettings.stroke.idle;
  };

  return (
    <div ref={setPanelElement} className={PANEL_ROOT_CLASS}>
      {/* 헤더 + 탭 영역 */}
      <div className="flex-shrink-0">
        {/* 헤더 */}
        <div className={PANEL_HEADER_CLASS}>
          <div className="flex items-center gap-[8px]">
            {selectedGroupInfo ? (
              isRenaming ? (
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
                    title={selectedGroupInfo.name}
                  >
                    {selectedGroupInfo.name}
                  </span>
                  <button
                    onClick={handleRenameStart}
                    className="w-[18px] h-[18px] flex items-center justify-center text-white/45 hover:text-white/90 transition-colors flex-shrink-0"
                    title={t('contextMenu.rename') || 'Rename'}
                  >
                    <RenameIcon />
                  </button>
                </div>
              )
            ) : (
              <span className="text-fg text-label leading-none">
                {t('propertiesPanel.multiSelection') || '다중 선택'}
              </span>
            )}
            {!selectedGroupInfo && (
              <span className="text-fg-faint text-body">
                ({selectedBatchStyleElements.length})
              </span>
            )}
          </div>
        </div>

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
            <div className="px-[12px] pb-[12px] flex flex-col gap-[12px]">
              <BatchStyleTabContent
                selectedCount={selectedBatchStyleElements.length}
                showSoundControls={selectedKeyElements.length > 0}
                getMixedValue={styleMixedValueGetter}
                getSelectedKeysData={styleSelectedDataGetter}
                afterSizeContent={
                  hasGraphSelection ? (
                    <>
                      <PropertyRow
                        label={t('propertiesPanel.graphShape') || 'Graph Shape'}
                      >
                        {graphTypeState.isMixed ? (
                          <span className="text-fg-faint text-body italic">
                            Mixed
                          </span>
                        ) : null}
                        <Dropdown
                          options={graphShapeOptions}
                          value={graphTypeState.value}
                          onChange={(value) =>
                            handleGraphBatchSharedSetting({
                              graphType: value as GraphItemType,
                            })
                          }
                        />
                      </PropertyRow>

                      {hasLineGraph && (
                        <div className="flex justify-between items-center w-full min-h-[32px]">
                          <p className="text-fg-muted text-label">
                            {t('propertiesPanel.graphShowAverageLine') ||
                              'Show Average Line'}
                          </p>
                          <Checkbox
                            checked={showAvgLineState.value}
                            onChange={() =>
                              handleGraphBatchSharedSetting({
                                showAvgLine: !showAvgLineState.value,
                              })
                            }
                          />
                        </div>
                      )}

                      <PropertyRow
                        label={t('propertiesPanel.graphSpeed') || 'Graph Speed'}
                      >
                        {graphSpeedState.isMixed ? (
                          <span className="text-fg-faint text-body italic">
                            Mixed
                          </span>
                        ) : null}
                        <NumberInput
                          value={graphSpeedState.value}
                          width="62px"
                          onChange={(value) => {
                            const clamped = Math.max(
                              500,
                              Math.min(5000, value),
                            );
                            const snapped = Math.round(clamped / 100) * 100;
                            handleGraphBatchSharedSetting({
                              graphSpeed: snapped,
                            });
                          }}
                          min={500}
                          max={5000}
                          suffix="ms"
                          isMixed={graphSpeedState.isMixed}
                        />
                      </PropertyRow>

                      <PropertyRow
                        label={t('propertiesPanel.graphColor') || 'Graph Color'}
                      >
                        {graphColorState.isMixed ? (
                          <span className="text-fg-faint text-body italic">
                            Mixed
                          </span>
                        ) : null}
                        <ColorInput
                          value={graphColorState.value}
                          onChange={() => {}}
                          onChangeComplete={(value) =>
                            handleGraphBatchSharedSetting({
                              graphColor: value,
                            })
                          }
                          colorId={`graph-batch-mixed-color-${selectedKeyType}`}
                          panelElement={panelElement}
                        />
                      </PropertyRow>

                      <div className="flex justify-between items-center w-full min-h-[32px]">
                        <p className="text-fg-muted text-label">
                          {t('propertiesPanel.graphAnimation') ||
                            'Graph Animation'}
                        </p>
                        <div className="flex items-center gap-[6px]">
                          {graphAnimationState.isMixed ? (
                            <span className="text-fg-faint text-body italic">
                              Mixed
                            </span>
                          ) : null}
                          <Checkbox
                            checked={graphAnimationState.value}
                            onChange={() =>
                              handleGraphBatchSharedSetting({
                                graphAnimationEnabled:
                                  !graphAnimationState.value,
                              })
                            }
                          />
                        </div>
                      </div>
                    </>
                  ) : undefined
                }
                handleBatchAlign={handleBatchAlign}
                handleBatchDistribute={handleBatchDistribute}
                handleBatchSpacing={handleBatchSpacing}
                handleBatchSpacingPreview={handleBatchSpacingPreview}
                handleBatchSpacingCommit={handleBatchSpacingCommit}
                batchSpacing={batchSpacing}
                handleBatchResize={handleBatchResize}
                handleBatchStyleChange={handleBatchStyleChange}
                handleBatchStyleChangeComplete={handleBatchStyleChangeComplete}
                handleBatchGradientCommit={handleBatchGradientCommit}
                getKeyOnlyMixedValue={getMixedValueKeysOnly}
                handleKeyOnlyStyleChangeComplete={
                  handleKeyOnlyStyleChangeComplete
                }
                showBatchImagePicker={showBatchImagePicker}
                onToggleBatchImagePicker={() =>
                  setShowBatchImagePicker(!showBatchImagePicker)
                }
                batchImageButtonRef={batchImageButtonRef}
                panelElement={panelElement}
                useCustomCSS={useCustomCSS}
                t={t}
              />
            </div>
          </div>

          {/* NOTE 탭 viewport */}
          {selectedKeyElements.length > 0 && (
            <div
              ref={batchScrollRefFor(TABS.NOTE)}
              className={`properties-panel-overlay-viewport ${
                activeTab === TABS.NOTE ? '' : 'hidden'
              }`}
            >
              <div className="px-[12px] pb-[12px] flex flex-col gap-[12px]">
                <BatchNoteTabContent
                  getMixedValue={getMixedValueKeysOnly}
                  handleBatchStyleChangeComplete={
                    handleBatchKeyOnlyStyleChangeComplete
                  }
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
              </div>
            </div>
          )}

          {/* COUNTER 탭 viewport */}
          <div
            ref={batchScrollRefFor(TABS.COUNTER)}
            className={`properties-panel-overlay-viewport ${
              activeTab === TABS.COUNTER ? '' : 'hidden'
            }`}
          >
            <div className="px-[12px] pb-[12px] flex flex-col gap-[12px]">
              <BatchCounterTabContent
                batchCounterSettings={batchCounterSettings}
                keyVisual={batchKeyVisual}
                handleBatchCounterUpdate={handleBatchCounterUpdate}
                colorState={batchCounterColorState}
                getCounterColorDisplay={getCounterColorDisplay}
                onFillPickerToggle={() => handleBatchPickerToggle('fill')}
                onStrokePickerToggle={() => handleBatchPickerToggle('stroke')}
                batchCounterFillButtonRef={batchCounterFillButtonRef}
                batchCounterStrokeButtonRef={batchCounterStrokeButtonRef}
                isFillPickerOpen={batchPickerFor === 'fill'}
                isStrokePickerOpen={batchPickerFor === 'stroke'}
                t={t}
              />
            </div>
          </div>
        </div>

        {/* 배치 편집용 로컬 ColorPicker */}
        {batchPickerFor && (
          <ColorPicker
            open={!!batchPickerFor}
            referenceRef={getBatchPickerRef()}
            panelElement={panelElement}
            color={getBatchPickerColor()}
            onColorChange={handleBatchPickerColorChange}
            onColorChangeComplete={handleBatchPickerColorChangeComplete}
            onClose={() => setBatchPickerFor(null)}
            interactiveRefs={batchColorPickerInteractiveRefs}
            solidOnly={
              batchPickerFor !== 'noteColor' && batchPickerFor !== 'glowColor'
            }
            stateMode={
              batchPickerFor === 'fill' || batchPickerFor === 'stroke'
                ? batchCounterColorState
                : undefined
            }
            onStateModeChange={
              batchPickerFor === 'fill' || batchPickerFor === 'stroke'
                ? setBatchCounterColorState
                : undefined
            }
            opacityPercent={
              batchPickerFor === 'noteColor'
                ? batchLocalOpacities.noteOpacity
                : batchPickerFor === 'glowColor'
                ? batchLocalOpacities.glowOpacity
                : undefined
            }
            onOpacityPercentChange={(value: number) => {
              if (batchPickerFor === 'noteColor') {
                setBatchLocalOpacities((prev) => ({
                  ...prev,
                  noteOpacity: value,
                }));
                handleBatchStyleChange('noteOpacity', value);
              } else if (batchPickerFor === 'glowColor') {
                setBatchLocalOpacities((prev) => ({
                  ...prev,
                  glowOpacity: value,
                }));
                handleBatchStyleChange('noteGlowOpacity', value);
              }
            }}
            onOpacityPercentChangeComplete={(value: number) => {
              if (batchPickerFor === 'noteColor') {
                setBatchLocalOpacities((prev) => ({
                  ...prev,
                  noteOpacity: value,
                }));
                handleBatchStyleChangeComplete('noteOpacity', value);
              } else if (batchPickerFor === 'glowColor') {
                setBatchLocalOpacities((prev) => ({
                  ...prev,
                  glowOpacity: value,
                }));
                handleBatchStyleChangeComplete('noteGlowOpacity', value);
              }
            }}
            opacityPercentLabel={
              batchPickerFor === 'noteColor'
                ? t('keySetting.noteOpacity') || '노트 투명도'
                : batchPickerFor === 'glowColor'
                ? t('keySetting.noteGlowOpacity') || '글로우 투명도'
                : undefined
            }
            opacityPercentMixed={
              batchPickerFor === 'noteColor'
                ? noteOpacityMixed
                : batchPickerFor === 'glowColor'
                ? glowOpacityMixed
                : false
            }
          />
        )}

        {/* 다중 선택용 ImagePicker */}
        {showBatchImagePicker && batchImageButtonRef.current && (
          <ImagePicker
            open={showBatchImagePicker}
            referenceRef={batchImageButtonRef}
            panelElement={panelElement}
            idleImage={
              styleMixedValueGetter((pos) => pos.inactiveImage, '').isMixed
                ? ''
                : styleMixedValueGetter((pos) => pos.inactiveImage, '').value
            }
            activeImage={
              styleMixedValueGetter((pos) => pos.activeImage, '').isMixed
                ? ''
                : styleMixedValueGetter((pos) => pos.activeImage, '').value
            }
            idleTransparent={
              styleMixedValueGetter((pos) => pos.idleTransparent, false).value
            }
            activeTransparent={
              styleMixedValueGetter((pos) => pos.activeTransparent, false).value
            }
            onIdleImageChange={(imageUrl: string) => {
              handleBatchStyleChangeComplete('inactiveImage', imageUrl);
            }}
            onActiveImageChange={(imageUrl: string) => {
              handleBatchStyleChangeComplete('activeImage', imageUrl);
            }}
            onIdleTransparentChange={(value: boolean) => {
              handleBatchStyleChangeComplete('idleTransparent', value);
            }}
            onActiveTransparentChange={(value: boolean) => {
              handleBatchStyleChangeComplete('activeTransparent', value);
            }}
            onIdleImageReset={() => {
              handleBatchStyleChangeComplete('inactiveImage', '');
            }}
            onActiveImageReset={() => {
              handleBatchStyleChangeComplete('activeImage', '');
            }}
            onClose={() => setShowBatchImagePicker(false)}
          />
        )}
      </>
    </div>
  );
};

// ============================================================================
// Graph-only batch selection panel
// ============================================================================

interface BatchGraphOnlyPanelProps {
  setPanelElement: (el: HTMLDivElement | null) => void;
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
    options?: { skipHistory?: boolean },
  ) => void;
  handleBatchSpacingPreview: (spacing: number) => void;
  handleBatchSpacingCommit: (
    spacing: number,
    options?: { skipHistory?: boolean },
  ) => void;
  getBatchSpacingValue: () => MixedValueResult<number>;
  handleBatchResize: (dimension: 'width' | 'height', value: number) => void;
  handleBatchStyleChange: (property: keyof KeyPosition, value: unknown) => void;
  handleBatchStyleChangeComplete: (
    property: keyof KeyPosition,
    value: unknown,
  ) => void;
  handleBatchGradientCommit?: (
    target: 'backgroundColor' | 'borderColor',
    state: 'idle' | 'active',
    value: ColorModeValue,
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
  handleBatchStyleChange,
  handleBatchStyleChangeComplete,
  handleBatchGradientCommit,
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
  const graphShapeOptions = [
    { label: t('propertiesPanel.graphShapeLine') || 'Line', value: 'line' },
    { label: t('propertiesPanel.graphShapeBar') || 'Bar', value: 'bar' },
  ];
  const graphTypeState = getMixedValueGraphs(
    (pos) => pos.graphType || 'line',
    'line' as string,
  );
  const showAvgLineState = getMixedValueGraphs(
    (pos) => pos.showAvgLine ?? true,
    true,
  );
  const graphSpeedState = getMixedValueGraphs(
    (pos) => Math.round(pos.graphSpeed || 1000),
    1000,
  );
  const graphColorState = getMixedValueGraphs(
    (pos) => pos.graphColor || '#86EFAC',
    '#86EFAC',
  );
  const graphAnimationState = getMixedValueGraphs(
    (pos) => pos.graphAnimationEnabled ?? true,
    true,
  );
  const hasLineGraph = getSelectedGraphsData().some(
    (data) =>
      ((data.position as GraphItemPosition | undefined)?.graphType ||
        'line') === 'line',
  );
  const batchGraphSpacing = getBatchSpacingValue();

  return (
    <div ref={setPanelElement} className={PANEL_ROOT_CLASS}>
      <div className="flex-shrink-0">
        <div className={PANEL_HEADER_CLASS}>
          <div className="flex items-center gap-[8px]">
            {selectedGroupInfo ? (
              isRenaming ? (
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
                    title={selectedGroupInfo.name}
                  >
                    {selectedGroupInfo.name}
                  </span>
                  <button
                    onClick={handleRenameStart}
                    className="w-[18px] h-[18px] flex items-center justify-center text-white/45 hover:text-white/90 transition-colors flex-shrink-0"
                    title={t('contextMenu.rename') || 'Rename'}
                  >
                    <RenameIcon />
                  </button>
                </div>
              )
            ) : (
              <span className="text-fg text-label leading-none">
                {t('propertiesPanel.multiSelection') || '다중 선택'}
              </span>
            )}
            {!selectedGroupInfo && (
              <span className="text-fg-faint text-body">
                ({selectedGraphElements.length})
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 properties-panel-overlay-scroll">
        <div
          ref={batchScrollRefFor(TABS.STYLE)}
          className="properties-panel-overlay-viewport"
        >
          <div className="px-[12px] pb-[12px] flex flex-col gap-[12px]">
            <BatchStyleTabContent
              selectedCount={selectedGraphElements.length}
              hideDisplayText
              hideFontControls
              showSoundControls={false}
              afterSizeContent={
                <>
                  <PropertyRow
                    label={t('propertiesPanel.graphShape') || 'Graph Shape'}
                  >
                    {graphTypeState.isMixed ? (
                      <span className="text-fg-faint text-body italic">
                        Mixed
                      </span>
                    ) : null}
                    <Dropdown
                      options={graphShapeOptions}
                      value={graphTypeState.value}
                      onChange={(value) =>
                        handleGraphBatchSharedSetting({
                          graphType: value as GraphItemType,
                        })
                      }
                    />
                  </PropertyRow>

                  {hasLineGraph && (
                    <div className="flex justify-between items-center w-full min-h-[32px]">
                      <p className="text-fg-muted text-label">
                        {t('propertiesPanel.graphShowAverageLine') ||
                          'Show Average Line'}
                      </p>
                      <Checkbox
                        checked={showAvgLineState.value}
                        onChange={() =>
                          handleGraphBatchSharedSetting({
                            showAvgLine: !showAvgLineState.value,
                          })
                        }
                      />
                    </div>
                  )}

                  <PropertyRow
                    label={t('propertiesPanel.graphSpeed') || 'Graph Speed'}
                  >
                    {graphSpeedState.isMixed ? (
                      <span className="text-fg-faint text-body italic">
                        Mixed
                      </span>
                    ) : null}
                    <NumberInput
                      value={graphSpeedState.value}
                      width="62px"
                      onChange={(value) => {
                        const clamped = Math.max(500, Math.min(5000, value));
                        const snapped = Math.round(clamped / 100) * 100;
                        handleGraphBatchSharedSetting({
                          graphSpeed: snapped,
                        });
                      }}
                      min={500}
                      max={5000}
                      suffix="ms"
                      isMixed={graphSpeedState.isMixed}
                    />
                  </PropertyRow>

                  <PropertyRow
                    label={t('propertiesPanel.graphColor') || 'Graph Color'}
                  >
                    {graphColorState.isMixed ? (
                      <span className="text-fg-faint text-body italic">
                        Mixed
                      </span>
                    ) : null}
                    <ColorInput
                      value={graphColorState.value}
                      onChange={() => {}}
                      onChangeComplete={(value) =>
                        handleGraphBatchSharedSetting({ graphColor: value })
                      }
                      colorId={`graph-batch-color-${selectedKeyType}`}
                      panelElement={panelElement}
                    />
                  </PropertyRow>

                  <div className="flex justify-between items-center w-full min-h-[32px]">
                    <p className="text-fg-muted text-label">
                      {t('propertiesPanel.graphAnimation') || 'Graph Animation'}
                    </p>
                    <div className="flex items-center gap-[6px]">
                      {graphAnimationState.isMixed ? (
                        <span className="text-fg-faint text-body italic">
                          Mixed
                        </span>
                      ) : null}
                      <Checkbox
                        checked={graphAnimationState.value}
                        onChange={() =>
                          handleGraphBatchSharedSetting({
                            graphAnimationEnabled: !graphAnimationState.value,
                          })
                        }
                      />
                    </div>
                  </div>
                </>
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
              handleBatchStyleChange={handleBatchStyleChange}
              handleBatchStyleChangeComplete={handleBatchStyleChangeComplete}
              handleBatchGradientCommit={handleBatchGradientCommit}
              showBatchImagePicker={showBatchImagePicker}
              onToggleBatchImagePicker={() =>
                setShowBatchImagePicker(!showBatchImagePicker)
              }
              batchImageButtonRef={batchImageButtonRef}
              panelElement={panelElement}
              useCustomCSS={useCustomCSS}
              t={t}
            />
          </div>
        </div>
      </div>

      {showBatchImagePicker && batchImageButtonRef.current && (
        <ImagePicker
          open={showBatchImagePicker}
          referenceRef={batchImageButtonRef}
          panelElement={panelElement}
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
          onIdleImageChange={(imageUrl: string) => {
            handleGraphBatchSharedSetting({ inactiveImage: imageUrl });
          }}
          onActiveImageChange={(imageUrl: string) => {
            handleGraphBatchSharedSetting({ activeImage: imageUrl });
          }}
          onIdleTransparentChange={(value: boolean) => {
            handleGraphBatchSharedSetting({ idleTransparent: value });
          }}
          onActiveTransparentChange={(value: boolean) => {
            handleGraphBatchSharedSetting({ activeTransparent: value });
          }}
          onIdleImageReset={() => {
            handleGraphBatchSharedSetting({ inactiveImage: '' });
          }}
          onActiveImageReset={() => {
            handleGraphBatchSharedSetting({ activeImage: '' });
          }}
          onClose={() => setShowBatchImagePicker(false)}
        />
      )}
    </div>
  );
};

// ============================================================================
// Knob-only batch selection panel
// ============================================================================

interface BatchKnobOnlyPanelProps {
  setPanelElement: (el: HTMLDivElement | null) => void;
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
    options?: { skipHistory?: boolean },
  ) => void;
  handleBatchSpacingPreview: (spacing: number) => void;
  handleBatchSpacingCommit: (
    spacing: number,
    options?: { skipHistory?: boolean },
  ) => void;
  getBatchSpacingValue: () => MixedValueResult<number>;
  handleBatchResize: (dimension: 'width' | 'height', value: number) => void;
  handleBatchStyleChange: (property: keyof KeyPosition, value: unknown) => void;
  handleBatchStyleChangeComplete: (
    property: keyof KeyPosition,
    value: unknown,
  ) => void;
  handleBatchGradientCommit?: (
    target: 'backgroundColor' | 'borderColor',
    state: 'idle' | 'active',
    value: ColorModeValue,
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
  handleBatchStyleChange,
  handleBatchStyleChangeComplete,
  handleBatchGradientCommit,
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
  t,
}) => {
  const sensitivityState = getMixedValueKnobs(
    (pos) => Number(pos.sensitivity ?? 1),
    1,
  );
  const reverseState = getMixedValueKnobs((pos) => pos.reverse ?? false, false);
  const batchKnobSpacing = getBatchSpacingValue();

  return (
    <div ref={setPanelElement} className={PANEL_ROOT_CLASS}>
      <div className="flex-shrink-0">
        <div className={PANEL_HEADER_CLASS}>
          <div className="flex items-center gap-[8px]">
            {selectedGroupInfo ? (
              isRenaming ? (
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
                    title={selectedGroupInfo.name}
                  >
                    {selectedGroupInfo.name}
                  </span>
                  <button
                    onClick={handleRenameStart}
                    className="w-[18px] h-[18px] flex items-center justify-center text-white/45 hover:text-white/90 transition-colors flex-shrink-0"
                    title={t('contextMenu.rename') || 'Rename'}
                  >
                    <RenameIcon />
                  </button>
                </div>
              )
            ) : (
              <span className="text-fg text-label leading-none">
                {t('propertiesPanel.multiSelection') || '다중 선택'}
              </span>
            )}
            {!selectedGroupInfo && (
              <span className="text-fg-faint text-body">
                ({selectedKnobElements.length})
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 properties-panel-overlay-scroll">
        <div
          ref={batchScrollRefFor(TABS.STYLE)}
          className="properties-panel-overlay-viewport"
        >
          <div className="px-[12px] pb-[12px] flex flex-col gap-[12px]">
            <BatchStyleTabContent
              selectedCount={selectedKnobElements.length}
              hideDisplayText
              hideFontControls
              showSoundControls={false}
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
              handleBatchStyleChange={handleBatchStyleChange}
              handleBatchStyleChangeComplete={handleBatchStyleChangeComplete}
              handleBatchGradientCommit={handleBatchGradientCommit}
              showBatchImagePicker={showBatchImagePicker}
              onToggleBatchImagePicker={() =>
                setShowBatchImagePicker(!showBatchImagePicker)
              }
              batchImageButtonRef={batchImageButtonRef}
              panelElement={panelElement}
              useCustomCSS={useCustomCSS}
              t={t}
            />
          </div>
        </div>
      </div>

      {showBatchImagePicker && batchImageButtonRef.current && (
        <ImagePicker
          open={showBatchImagePicker}
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
          onIdleImageChange={(imageUrl: string) => {
            handleKnobBatchSharedSetting({ inactiveImage: imageUrl });
          }}
          onActiveImageChange={(imageUrl: string) => {
            handleKnobBatchSharedSetting({ activeImage: imageUrl });
          }}
          onIdleTransparentChange={(value: boolean) => {
            handleKnobBatchSharedSetting({ idleTransparent: value });
          }}
          onActiveTransparentChange={(value: boolean) => {
            handleKnobBatchSharedSetting({ activeTransparent: value });
          }}
          onIdleImageReset={() => {
            handleKnobBatchSharedSetting({ inactiveImage: '' });
          }}
          onActiveImageReset={() => {
            handleKnobBatchSharedSetting({ activeImage: '' });
          }}
          onClose={() => setShowBatchImagePicker(false)}
        />
      )}
    </div>
  );
};
