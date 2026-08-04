import React, { useState, useRef, useEffect } from 'react';
import type { KeyPosition } from '@src/types/key/keys';
import {
  PropertyRow,
  NumberInput,
  ColorInput,
  TextInput,
  SectionDivider,
  FontStyleToggle,
} from '../index';
import Checkbox from '@components/main/common/Checkbox';
import FontPicker from '@components/main/Modal/content/pickers/FontPicker';
import SoundPicker from '@components/main/Modal/content/pickers/SoundPicker';

const SPACING_COMMIT_DEBOUNCE_MS = 80;
const SPACING_COMMIT_EPSILON = 0.0001;

interface KeyData {
  index: number;
  position: KeyPosition | undefined;
  keyCode: string | null;
  keyInfo: { globalKey: string; displayName: string } | null;
}

interface BatchStyleTabContentProps {
  // 다중 선택 정보
  selectedCount: number;
  hideDisplayText?: boolean;
  hideFontControls?: boolean;
  showSoundControls?: boolean;
  afterSizeContent?: React.ReactNode;
  // getMixedValue 함수
  getMixedValue: <T>(
    getter: (pos: KeyPosition) => T | undefined,
    defaultValue: T,
  ) => { isMixed: boolean; value: T };
  // getSelectedKeysData 함수 (displayText Mixed 판단용)
  getSelectedKeysData: () => KeyData[];
  // 핸들러
  handleBatchAlign: (
    direction: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom',
  ) => void;
  handleBatchDistribute: (direction: 'horizontal' | 'vertical') => void;
  handleBatchSpacing: (
    spacing: number,
    options?: { skipHistory?: boolean },
  ) => void;
  handleBatchSpacingPreview?: (spacing: number) => void;
  handleBatchSpacingCommit?: (
    spacing: number,
    options?: { skipHistory?: boolean },
  ) => void;
  batchSpacing: { isMixed: boolean; value: number };
  handleBatchResize: (dimension: 'width' | 'height', value: number) => void;
  handleBatchStyleChange: (property: keyof KeyPosition, value: unknown) => void;
  handleBatchStyleChangeComplete: (
    property: keyof KeyPosition,
    value: unknown,
  ) => void;
  // 키 전용 (사운드 등)
  getKeyOnlyMixedValue?: <T>(
    getter: (pos: KeyPosition) => T | undefined,
    defaultValue: T,
  ) => { isMixed: boolean; value: T };
  handleKeyOnlyStyleChangeComplete?: (
    property: keyof KeyPosition,
    value: unknown,
  ) => void;
  // 이미지 피커
  showBatchImagePicker: boolean;
  onToggleBatchImagePicker: () => void;
  batchImageButtonRef: React.RefObject<HTMLButtonElement>;
  // 기타
  panelElement: HTMLElement | null;
  useCustomCSS: boolean;
  t: (key: string) => string;
}

const BatchStyleTabContent: React.FC<BatchStyleTabContentProps> = ({
  selectedCount,
  hideDisplayText = false,
  hideFontControls = false,
  showSoundControls = false,
  afterSizeContent,
  getMixedValue,
  getSelectedKeysData,
  handleBatchAlign,
  handleBatchDistribute,
  handleBatchSpacing,
  handleBatchSpacingCommit,
  batchSpacing,
  handleBatchResize,
  handleBatchStyleChange,
  handleBatchStyleChangeComplete,
  getKeyOnlyMixedValue,
  handleKeyOnlyStyleChangeComplete,
  showBatchImagePicker,
  onToggleBatchImagePicker,
  batchImageButtonRef,
  panelElement,
  useCustomCSS,
  t,
}) => {
  const [colorState, setColorState] = useState<'idle' | 'active'>('idle');
  const [showFontPicker, setShowFontPicker] = useState(false);
  const [showSoundPicker, setShowSoundPicker] = useState(false);

  // 간격 입력 세션 동안 첫 변경만 히스토리를 남기고 이후는 skipHistory로 묶는다.
  const lastSpacingRef = useRef<number | null>(null);
  const lastCommittedSpacingRef = useRef<number | null>(null);
  const spacingDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const spacingHistorySeededRef = useRef(false);

  const isSameSpacingValue = (a: number | null, b: number | null): boolean => {
    if (a === null || b === null) return false;
    return Math.abs(a - b) < SPACING_COMMIT_EPSILON;
  };

  const commitSpacing = (spacing: number) => {
    const options = spacingHistorySeededRef.current
      ? { skipHistory: true }
      : undefined;

    if (handleBatchSpacingCommit) {
      handleBatchSpacingCommit(spacing, options);
    } else {
      handleBatchSpacing(spacing, options);
    }

    spacingHistorySeededRef.current = true;
    lastCommittedSpacingRef.current = spacing;
  };

  const onSpacingChange = (value: number) => {
    lastSpacingRef.current = value;
    if (spacingDebounceTimerRef.current) {
      clearTimeout(spacingDebounceTimerRef.current);
    }
    spacingDebounceTimerRef.current = setTimeout(() => {
      spacingDebounceTimerRef.current = null;
      const spacing = lastSpacingRef.current;
      if (spacing === null) return;
      if (isSameSpacingValue(lastCommittedSpacingRef.current, spacing)) return;
      commitSpacing(spacing);
    }, SPACING_COMMIT_DEBOUNCE_MS);
  };

  const onSpacingBlur = () => {
    if (spacingDebounceTimerRef.current) {
      clearTimeout(spacingDebounceTimerRef.current);
      spacingDebounceTimerRef.current = null;
    }
    if (
      !isSameSpacingValue(
        lastCommittedSpacingRef.current,
        lastSpacingRef.current,
      )
    ) {
      const spacing = lastSpacingRef.current;
      if (spacing !== null) {
        commitSpacing(spacing);
      }
    }

    lastSpacingRef.current = null;
    lastCommittedSpacingRef.current = null;
    spacingHistorySeededRef.current = false;
  };

  useEffect(() => {
    return () => {
      if (spacingDebounceTimerRef.current) {
        clearTimeout(spacingDebounceTimerRef.current);
      }
    };
  }, []);
  const fontButtonRef = useRef<HTMLButtonElement>(null);
  const soundButtonRef = useRef<HTMLButtonElement>(null);

  // displayText의 실제 표시 값(displayText || keyInfo.displayName)을 기준으로 Mixed 판단
  const getDisplayTextMixed = (): { isMixed: boolean; value: string } => {
    const keysData = getSelectedKeysData();
    if (keysData.length === 0) return { isMixed: false, value: '' };

    const getEffectiveDisplayText = (data: KeyData): string => {
      const displayText = data.position?.displayText;
      if (displayText) return displayText;
      return data.keyInfo?.displayName || '';
    };

    const firstValue = getEffectiveDisplayText(keysData[0]);
    const isMixed = keysData.some(
      (data) => getEffectiveDisplayText(data) !== firstValue,
    );

    return { isMixed, value: firstValue };
  };

  return (
    <>
      {/* 정렬 */}
      <PropertyRow label={t('propertiesPanel.alignment') || '정렬'}>
        <div className="flex gap-[4px]">
          {/* 수평 정렬 */}
          <div className="flex">
            <button
              type="button"
              onClick={() => handleBatchAlign('left')}
              className="w-[24px] h-[23px] bg-[#2A2A30] border border-[#3A3943] rounded-l-[7px] border-r-0 flex items-center justify-center hover:bg-[#353540] transition-colors"
              title={t('propertiesPanel.alignLeft') || '왼쪽 정렬'}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path
                  d="M1 1V9"
                  stroke="#DBDEE8"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <rect
                  x="2.5"
                  y="2.5"
                  width="6"
                  height="1.5"
                  rx="0.5"
                  fill="#DBDEE8"
                />
                <rect
                  x="2.5"
                  y="6"
                  width="4"
                  height="1.5"
                  rx="0.5"
                  fill="#DBDEE8"
                />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => handleBatchAlign('centerH')}
              className="w-[24px] h-[23px] bg-[#2A2A30] border border-[#3A3943] border-r-0 flex items-center justify-center hover:bg-[#353540] transition-colors"
              title={t('propertiesPanel.alignCenterH') || '수평 중앙 정렬'}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path
                  d="M5 1V9"
                  stroke="#DBDEE8"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <rect
                  x="1.5"
                  y="2.5"
                  width="7"
                  height="1.5"
                  rx="0.5"
                  fill="#DBDEE8"
                />
                <rect
                  x="2.5"
                  y="6"
                  width="5"
                  height="1.5"
                  rx="0.5"
                  fill="#DBDEE8"
                />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => handleBatchAlign('right')}
              className="w-[24px] h-[23px] bg-[#2A2A30] border border-[#3A3943] rounded-r-[7px] flex items-center justify-center hover:bg-[#353540] transition-colors"
              title={t('propertiesPanel.alignRight') || '오른쪽 정렬'}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path
                  d="M9 1V9"
                  stroke="#DBDEE8"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <rect
                  x="1.5"
                  y="2.5"
                  width="6"
                  height="1.5"
                  rx="0.5"
                  fill="#DBDEE8"
                />
                <rect
                  x="3.5"
                  y="6"
                  width="4"
                  height="1.5"
                  rx="0.5"
                  fill="#DBDEE8"
                />
              </svg>
            </button>
          </div>
          {/* 수직 정렬 */}
          <div className="flex">
            <button
              type="button"
              onClick={() => handleBatchAlign('top')}
              className="w-[24px] h-[23px] bg-[#2A2A30] border border-[#3A3943] rounded-l-[7px] border-r-0 flex items-center justify-center hover:bg-[#353540] transition-colors"
              title={t('propertiesPanel.alignTop') || '위쪽 정렬'}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path
                  d="M1 1H9"
                  stroke="#DBDEE8"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <rect
                  x="2.5"
                  y="2.5"
                  width="1.5"
                  height="6"
                  rx="0.5"
                  fill="#DBDEE8"
                />
                <rect
                  x="6"
                  y="2.5"
                  width="1.5"
                  height="4"
                  rx="0.5"
                  fill="#DBDEE8"
                />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => handleBatchAlign('centerV')}
              className="w-[24px] h-[23px] bg-[#2A2A30] border border-[#3A3943] border-r-0 flex items-center justify-center hover:bg-[#353540] transition-colors"
              title={t('propertiesPanel.alignCenterV') || '수직 중앙 정렬'}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path
                  d="M1 5H9"
                  stroke="#DBDEE8"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <rect
                  x="2.5"
                  y="1.5"
                  width="1.5"
                  height="7"
                  rx="0.5"
                  fill="#DBDEE8"
                />
                <rect
                  x="6"
                  y="2.5"
                  width="1.5"
                  height="5"
                  rx="0.5"
                  fill="#DBDEE8"
                />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => handleBatchAlign('bottom')}
              className="w-[24px] h-[23px] bg-[#2A2A30] border border-[#3A3943] rounded-r-[7px] flex items-center justify-center hover:bg-[#353540] transition-colors"
              title={t('propertiesPanel.alignBottom') || '아래쪽 정렬'}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path
                  d="M1 9H9"
                  stroke="#DBDEE8"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <rect
                  x="2.5"
                  y="1.5"
                  width="1.5"
                  height="6"
                  rx="0.5"
                  fill="#DBDEE8"
                />
                <rect
                  x="6"
                  y="3.5"
                  width="1.5"
                  height="4"
                  rx="0.5"
                  fill="#DBDEE8"
                />
              </svg>
            </button>
          </div>
        </div>
      </PropertyRow>

      {/* 분배 */}
      <PropertyRow label={t('propertiesPanel.distribution') || '분배'}>
        <div className="flex gap-[4px]">
          <button
            type="button"
            onClick={() => handleBatchDistribute('horizontal')}
            disabled={selectedCount < 3}
            className={`w-[24px] h-[23px] bg-[#2A2A30] border border-[#3A3943] rounded-[7px] flex items-center justify-center transition-colors ${
              selectedCount < 3
                ? 'opacity-40 cursor-not-allowed'
                : 'hover:bg-[#353540]'
            }`}
            title={t('propertiesPanel.distributeH') || '수평 분배'}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <rect
                x="0.5"
                y="2.5"
                width="1.5"
                height="5"
                rx="0.5"
                fill="#DBDEE8"
              />
              <rect
                x="4.25"
                y="2.5"
                width="1.5"
                height="5"
                rx="0.5"
                fill="#DBDEE8"
              />
              <rect
                x="8"
                y="2.5"
                width="1.5"
                height="5"
                rx="0.5"
                fill="#DBDEE8"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => handleBatchDistribute('vertical')}
            disabled={selectedCount < 3}
            className={`w-[24px] h-[23px] bg-[#2A2A30] border border-[#3A3943] rounded-[7px] flex items-center justify-center transition-colors ${
              selectedCount < 3
                ? 'opacity-40 cursor-not-allowed'
                : 'hover:bg-[#353540]'
            }`}
            title={t('propertiesPanel.distributeV') || '수직 분배'}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <rect
                x="2.5"
                y="0.5"
                width="5"
                height="1.5"
                rx="0.5"
                fill="#DBDEE8"
              />
              <rect
                x="2.5"
                y="4.25"
                width="5"
                height="1.5"
                rx="0.5"
                fill="#DBDEE8"
              />
              <rect
                x="2.5"
                y="8"
                width="5"
                height="1.5"
                rx="0.5"
                fill="#DBDEE8"
              />
            </svg>
          </button>
        </div>
      </PropertyRow>

      {/* 간격 */}
      <PropertyRow label={t('propertiesPanel.spacing') || '간격'}>
        <NumberInput
          value={batchSpacing.value}
          onChange={onSpacingChange}
          onBlur={onSpacingBlur}
          suffix="px"
          min={0}
          max={500}
          allowDecimal
          decimalScale={1}
          isMixed={batchSpacing.isMixed}
        />
      </PropertyRow>

      {/* 크기 */}
      <PropertyRow label={t('propertiesPanel.size') || '크기'}>
        <NumberInput
          value={getMixedValue((pos) => pos.width, 60).value}
          onChange={(value) => handleBatchResize('width', value)}
          prefix="W"
          min={10}
          max={500}
          allowDecimal
          decimalScale={1}
          isMixed={getMixedValue((pos) => pos.width, 60).isMixed}
        />
        <NumberInput
          value={getMixedValue((pos) => pos.height, 60).value}
          onChange={(value) => handleBatchResize('height', value)}
          prefix="H"
          min={10}
          max={500}
          allowDecimal
          decimalScale={1}
          isMixed={getMixedValue((pos) => pos.height, 60).isMixed}
        />
      </PropertyRow>

      {afterSizeContent ? (
        <>
          <SectionDivider />
          {afterSizeContent}
          <SectionDivider />
        </>
      ) : (
        <SectionDivider />
      )}

      {/* 배경색 */}
      <PropertyRow label={t('propertiesPanel.backgroundColor') || '배경색'}>
        {(
          colorState === 'active'
            ? getMixedValue(
                (pos) => pos.activeBackgroundColor ?? pos.backgroundColor,
                'rgba(121, 121, 121, 0.9)',
              ).isMixed
            : getMixedValue(
                (pos) => pos.backgroundColor,
                'rgba(46, 46, 47, 0.9)',
              ).isMixed
        ) ? (
          <span className="text-[#6B6D75] text-style-4 italic">Mixed</span>
        ) : null}
        <ColorInput
          value={
            getMixedValue((pos) => pos.backgroundColor, 'rgba(46, 46, 47, 0.9)')
              .value
          }
          activeValue={
            getMixedValue(
              (pos) => pos.activeBackgroundColor ?? pos.backgroundColor,
              'rgba(121, 121, 121, 0.9)',
            ).value
          }
          showStateTabs
          stateMode={colorState}
          onStateModeChange={setColorState}
          onChange={(color) => handleBatchStyleChange('backgroundColor', color)}
          onChangeComplete={(color) =>
            handleBatchStyleChangeComplete('backgroundColor', color)
          }
          onActiveChange={(color) =>
            handleBatchStyleChange('activeBackgroundColor', color)
          }
          onActiveChangeComplete={(color) =>
            handleBatchStyleChangeComplete('activeBackgroundColor', color)
          }
          panelElement={panelElement}
        />
      </PropertyRow>

      {/* 테두리 색상 */}
      <PropertyRow label={t('propertiesPanel.borderColor') || '테두리 색상'}>
        {(
          colorState === 'active'
            ? getMixedValue(
                (pos) => pos.activeBorderColor ?? pos.borderColor,
                'rgba(255, 255, 255, 0.9)',
              ).isMixed
            : getMixedValue(
                (pos) => pos.borderColor,
                'rgba(113, 113, 113, 0.9)',
              ).isMixed
        ) ? (
          <span className="text-[#6B6D75] text-style-4 italic">Mixed</span>
        ) : null}
        <ColorInput
          value={
            getMixedValue((pos) => pos.borderColor, 'rgba(113, 113, 113, 0.9)')
              .value
          }
          activeValue={
            getMixedValue(
              (pos) => pos.activeBorderColor ?? pos.borderColor,
              'rgba(255, 255, 255, 0.9)',
            ).value
          }
          showStateTabs
          stateMode={colorState}
          onStateModeChange={setColorState}
          onChange={(color) => handleBatchStyleChange('borderColor', color)}
          onChangeComplete={(color) =>
            handleBatchStyleChangeComplete('borderColor', color)
          }
          onActiveChange={(color) =>
            handleBatchStyleChange('activeBorderColor', color)
          }
          onActiveChangeComplete={(color) =>
            handleBatchStyleChangeComplete('activeBorderColor', color)
          }
          panelElement={panelElement}
        />
      </PropertyRow>

      {/* 테두리 두께 */}
      <PropertyRow label={t('propertiesPanel.borderWidth') || '테두리 두께'}>
        {getMixedValue((pos) => pos.borderWidth, 3).isMixed ? (
          <span className="text-[#6B6D75] text-style-4 italic">Mixed</span>
        ) : null}
        <NumberInput
          value={getMixedValue((pos) => pos.borderWidth, 3).value}
          onChange={(value) =>
            handleBatchStyleChangeComplete('borderWidth', value)
          }
          suffix="px"
          min={0}
          max={20}
          allowDecimal
          decimalScale={1}
        />
      </PropertyRow>

      {/* 모서리 반경 */}
      <PropertyRow label={t('propertiesPanel.borderRadius') || '모서리 반경'}>
        {getMixedValue((pos) => pos.borderRadius, 10).isMixed ? (
          <span className="text-[#6B6D75] text-style-4 italic">Mixed</span>
        ) : null}
        <NumberInput
          value={getMixedValue((pos) => pos.borderRadius, 10).value}
          onChange={(value) =>
            handleBatchStyleChangeComplete('borderRadius', value)
          }
          suffix="px"
          min={0}
          max={100}
          allowDecimal
          decimalScale={1}
        />
      </PropertyRow>

      {/* 커스텀 이미지 */}
      <PropertyRow label={t('propertiesPanel.customImage') || '커스텀 이미지'}>
        <button
          ref={batchImageButtonRef}
          type="button"
          className={`px-[7px] h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] flex items-center justify-center ${
            showBatchImagePicker ? 'border-[#459BF8]' : 'border-[#3A3943]'
          } text-[#DBDEE8] text-style-4`}
          onClick={onToggleBatchImagePicker}
        >
          {t('propertiesPanel.configure') || '설정하기'}
        </button>
      </PropertyRow>

      {!hideDisplayText || !hideFontControls ? <SectionDivider /> : null}

      {/* 표시 텍스트 */}
      {!hideDisplayText && (
        <PropertyRow label={t('propertiesPanel.displayText') || '표시 텍스트'}>
          {(() => {
            const { isMixed, value } = getDisplayTextMixed();
            const displayTextValue = getMixedValue(
              (pos) => pos.displayText,
              '',
            ).value;
            // displayText가 직접 설정되어 있으면 그 값을 value에, 아니면 placeholder에 기본값 표시
            return (
              <TextInput
                value={isMixed ? '' : displayTextValue}
                onChange={(v) =>
                  handleBatchStyleChangeComplete('displayText', v)
                }
                placeholder={isMixed ? 'Mixed' : value}
                width="54px"
                isMixed={isMixed}
              />
            );
          })()}
        </PropertyRow>
      )}

      {!hideFontControls && (
        <>
          {/* 폰트 */}
          <PropertyRow label={t('propertiesPanel.font') || '폰트'}>
            {getMixedValue((pos) => pos.fontFamily, null).isMixed ? (
              <span className="text-[#6B6D75] text-style-4 italic">Mixed</span>
            ) : null}
            <button
              ref={fontButtonRef}
              type="button"
              className={`px-[7px] h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] flex items-center justify-center ${
                showFontPicker ? 'border-[#459BF8]' : 'border-[#3A3943]'
              } text-[#DBDEE8] text-style-4`}
              onClick={() => setShowFontPicker(!showFontPicker)}
            >
              {t('propertiesPanel.configure') || '설정하기'}
            </button>
          </PropertyRow>

          {/* 글꼴 크기 */}
          <PropertyRow label={t('propertiesPanel.fontSize') || '글꼴 크기'}>
            {getMixedValue((pos) => pos.fontSize, 14).isMixed ? (
              <span className="text-[#6B6D75] text-style-4 italic">Mixed</span>
            ) : null}
            <NumberInput
              value={getMixedValue((pos) => pos.fontSize, 14).value}
              onChange={(value) =>
                handleBatchStyleChangeComplete('fontSize', value)
              }
              suffix="px"
              min={8}
              max={72}
              allowDecimal
              decimalScale={1}
            />
          </PropertyRow>

          {/* 글꼴 색상 */}
          <PropertyRow label={t('propertiesPanel.fontColor') || '글꼴 색상'}>
            {(
              colorState === 'active'
                ? getMixedValue(
                    (pos) => pos.activeFontColor ?? pos.fontColor,
                    '#FFFFFF',
                  ).isMixed
                : getMixedValue(
                    (pos) => pos.fontColor,
                    'rgba(121, 121, 121, 0.9)',
                  ).isMixed
            ) ? (
              <span className="text-[#6B6D75] text-style-4 italic">Mixed</span>
            ) : null}
            <ColorInput
              value={
                getMixedValue(
                  (pos) => pos.fontColor,
                  'rgba(121, 121, 121, 0.9)',
                ).value
              }
              activeValue={
                getMixedValue(
                  (pos) => pos.activeFontColor ?? pos.fontColor,
                  '#FFFFFF',
                ).value
              }
              showStateTabs
              stateMode={colorState}
              onStateModeChange={setColorState}
              onChange={(color) => handleBatchStyleChange('fontColor', color)}
              onChangeComplete={(color) =>
                handleBatchStyleChangeComplete('fontColor', color)
              }
              onActiveChange={(color) =>
                handleBatchStyleChange('activeFontColor', color)
              }
              onActiveChangeComplete={(color) =>
                handleBatchStyleChangeComplete('activeFontColor', color)
              }
              panelElement={panelElement}
            />
          </PropertyRow>

          {/* 글꼴 스타일 */}
          <PropertyRow label={t('propertiesPanel.fontStyle') || '글꼴 스타일'}>
            <FontStyleToggle
              isBold={
                getMixedValue((pos) => (pos.fontWeight ?? 700) >= 700, true)
                  .value
              }
              isItalic={getMixedValue((pos) => pos.fontItalic, false).value}
              isUnderline={
                getMixedValue((pos) => pos.fontUnderline, false).value
              }
              isStrikethrough={
                getMixedValue((pos) => pos.fontStrikethrough, false).value
              }
              onBoldChange={(value) =>
                handleBatchStyleChangeComplete('fontWeight', value ? 700 : 400)
              }
              onItalicChange={(value) =>
                handleBatchStyleChangeComplete('fontItalic', value)
              }
              onUnderlineChange={(value) =>
                handleBatchStyleChangeComplete('fontUnderline', value)
              }
              onStrikethroughChange={(value) =>
                handleBatchStyleChangeComplete('fontStrikethrough', value)
              }
            />
          </PropertyRow>
        </>
      )}

      {/* 커스텀 CSS 활성화 시에만 클래스명 및 CSS 우선순위 표시 */}
      {useCustomCSS && (
        <>
          <SectionDivider />

          {/* CSS 우선순위 토글 */}
          <div className="flex justify-between items-center w-full h-[23px]">
            <p className="text-white text-style-2">
              {t('propertiesPanel.useInlineStyles') || '인라인 스타일 우선'}
            </p>
            <Checkbox
              checked={getMixedValue((pos) => pos.useInlineStyles, false).value}
              onChange={() => {
                const currentValue = getMixedValue(
                  (pos) => pos.useInlineStyles,
                  false,
                ).value;
                handleBatchStyleChangeComplete(
                  'useInlineStyles',
                  !currentValue,
                );
              }}
            />
          </div>

          {/* 클래스명 */}
          <PropertyRow label={t('propertiesPanel.className') || '클래스'}>
            <TextInput
              value={
                getMixedValue((pos) => pos.className, '').isMixed
                  ? ''
                  : getMixedValue((pos) => pos.className, '').value
              }
              onChange={(value) => {
                handleBatchStyleChangeComplete('className', value);
              }}
              placeholder={
                getMixedValue((pos) => pos.className, '').isMixed
                  ? 'Mixed'
                  : 'className'
              }
              width="90px"
              isMixed={getMixedValue((pos) => pos.className, '').isMixed}
            />
          </PropertyRow>
        </>
      )}

      {showSoundControls &&
        (() => {
          const soundMixedValue = getKeyOnlyMixedValue ?? getMixedValue;
          const soundChangeComplete =
            handleKeyOnlyStyleChangeComplete ?? handleBatchStyleChangeComplete;
          return (
            <>
              <SectionDivider />

              <PropertyRow
                label={
                  t('propertiesPanel.keySoundEnabled') || '키 사운드 활성화'
                }
              >
                {soundMixedValue((pos) => pos.soundEnabled, false).isMixed ? (
                  <span className="text-[#6B6D75] text-style-4 italic">
                    Mixed
                  </span>
                ) : null}
                <Checkbox
                  checked={
                    soundMixedValue((pos) => pos.soundEnabled, false).value
                  }
                  onChange={() => {
                    const current = soundMixedValue(
                      (pos) => pos.soundEnabled,
                      false,
                    ).value;
                    soundChangeComplete('soundEnabled', !current);
                  }}
                />
              </PropertyRow>

              <PropertyRow label={t('propertiesPanel.keySound') || '키 사운드'}>
                {soundMixedValue((pos) => pos.soundPath, '').isMixed ? (
                  <span className="text-[#6B6D75] text-style-4 italic">
                    Mixed
                  </span>
                ) : null}
                <button
                  ref={soundButtonRef}
                  type="button"
                  className={`px-[7px] h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] flex items-center justify-center ${
                    showSoundPicker ? 'border-[#459BF8]' : 'border-[#3A3943]'
                  } text-[#DBDEE8] text-style-4`}
                  onClick={() => setShowSoundPicker((prev) => !prev)}
                >
                  {t('propertiesPanel.configure') || '설정하기'}
                </button>
              </PropertyRow>

              <PropertyRow
                label={t('propertiesPanel.soundVolume') || '사운드 볼륨'}
              >
                {soundMixedValue((pos) => pos.soundVolume, 100).isMixed ? (
                  <span className="text-[#6B6D75] text-style-4 italic">
                    Mixed
                  </span>
                ) : null}
                <NumberInput
                  value={soundMixedValue((pos) => pos.soundVolume, 100).value}
                  onChange={(value) =>
                    soundChangeComplete(
                      'soundVolume',
                      Math.max(0, Math.min(200, value)),
                    )
                  }
                  suffix="%"
                  min={0}
                  max={200}
                  isMixed={
                    soundMixedValue((pos) => pos.soundVolume, 100).isMixed
                  }
                />
              </PropertyRow>
            </>
          );
        })()}

      {/* FontPicker */}
      {!hideFontControls && showFontPicker && (
        <FontPicker
          open={true}
          referenceRef={fontButtonRef}
          panelElement={panelElement}
          selectedFont={getMixedValue((pos) => pos.fontFamily, null).value}
          onFontSelect={(fontName) => {
            handleBatchStyleChangeComplete('fontFamily', fontName);
          }}
          onClose={() => setShowFontPicker(false)}
          interactiveRefs={[fontButtonRef]}
        />
      )}

      {/* SoundPicker */}
      {showSoundControls && showSoundPicker && (
        <SoundPicker
          open={true}
          referenceRef={soundButtonRef}
          panelElement={panelElement}
          selectedSound={
            (getKeyOnlyMixedValue ?? getMixedValue)((pos) => pos.soundPath, '')
              .value || null
          }
          onSoundSelect={(soundPath) => {
            (
              handleKeyOnlyStyleChangeComplete ?? handleBatchStyleChangeComplete
            )('soundPath', soundPath || '');
          }}
          onClose={() => setShowSoundPicker(false)}
          interactiveRefs={[soundButtonRef]}
          previewVolume={
            (getKeyOnlyMixedValue ?? getMixedValue)(
              (pos) => pos.soundVolume,
              100,
            ).value
          }
        />
      )}
    </>
  );
};

export default BatchStyleTabContent;
