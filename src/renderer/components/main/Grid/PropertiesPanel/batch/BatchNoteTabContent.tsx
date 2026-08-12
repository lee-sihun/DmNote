import React from 'react';
import type { KeyPosition } from '@src/types/key/keys';
import {
  PropertyRow,
  NumberInput,
  OptionalNumberInput,
  PropertySection,
} from '../index';
import Checkbox from '@components/main/common/Checkbox';
import Dropdown from '@components/main/common/Dropdown';
import { NOTE_SETTINGS_CONSTRAINTS } from '@src/types/settings/noteSettingsConstraints';
import { useSettingsStore } from '@stores/useSettingsStore';
import { ColorSwatchButton } from '@components/main/Modal/content/pickers/ColorSwatch';
import { AXIS_FIELD_WIDTH } from '@utils/cardRecipes';
import { createNoteLiteralHandlers } from '../noteLiteralHandlers';

interface SwatchDisplay {
  color?: string;
  gradient?: { top: string; bottom: string };
  opacity: number | { top: number; bottom: number };
  label: string;
  isMixed: boolean;
}

interface BatchNoteTabContentProps {
  // getMixedValue 함수
  getMixedValue: <T>(
    getter: (pos: KeyPosition) => T | undefined,
    defaultValue: T,
  ) => { isMixed: boolean; value: T };
  // 핸들러
  handleBatchStyleChangeComplete: (
    property: keyof KeyPosition,
    value: KeyPosition[keyof KeyPosition],
  ) => void;
  // 노트/글로우 색상 디스플레이
  getBatchNoteColorDisplay: () => SwatchDisplay;
  getBatchGlowColorDisplay: () => SwatchDisplay;
  getBatchBorderColorDisplay: () => SwatchDisplay;
  // 컬러 피커 토글
  onNoteColorPickerToggle: () => void;
  onGlowColorPickerToggle: () => void;
  onBorderColorPickerToggle: () => void;
  isNoteColorPickerOpen: boolean;
  isGlowColorPickerOpen: boolean;
  isBorderColorPickerOpen: boolean;
  batchNoteColorButtonRef: React.RefObject<HTMLButtonElement>;
  batchGlowColorButtonRef: React.RefObject<HTMLButtonElement>;
  batchBorderColorButtonRef: React.RefObject<HTMLButtonElement>;
  // 번역
  t: (key: string) => string;
}

const BatchNoteTabContent: React.FC<BatchNoteTabContentProps> = ({
  getMixedValue,
  handleBatchStyleChangeComplete,
  getBatchNoteColorDisplay,
  getBatchGlowColorDisplay,
  getBatchBorderColorDisplay,
  onNoteColorPickerToggle,
  onGlowColorPickerToggle,
  onBorderColorPickerToggle,
  isNoteColorPickerOpen,
  isGlowColorPickerOpen,
  isBorderColorPickerOpen,
  batchNoteColorButtonRef,
  batchGlowColorButtonRef,
  batchBorderColorButtonRef,
  t,
}) => {
  const { noteEffect: _noteEffect } = useSettingsStore();

  const noteWidthMixed = getMixedValue<number | undefined>(
    (pos) => pos.noteWidth,
    undefined,
  );
  const noteColorDisplay = getBatchNoteColorDisplay();
  const glowColorDisplay = getBatchGlowColorDisplay();
  const borderColorDisplay = getBatchBorderColorDisplay();
  const noteLiteralHandlers = createNoteLiteralHandlers(
    {
      noteEffectEnabled: getMixedValue((pos) => pos.noteEffectEnabled, true)
        .value,
      noteAutoYCorrection: getMixedValue((pos) => pos.noteAutoYCorrection, true)
        .value,
      noteGlowEnabled: getMixedValue((pos) => pos.noteGlowEnabled, false).value,
    },
    handleBatchStyleChangeComplete,
  );

  return (
    <>
      <PropertySection>
        {/* 노트 효과 표시 */}
        <div className="flex justify-between items-center w-full min-h-[32px]">
          <p className="text-fg-muted text-label">
            {t('keySetting.noteEffectEnabled') || '노트 효과 표시'}
          </p>
          <Checkbox
            commitStrategy="after-paint"
            checked={getMixedValue((pos) => pos.noteEffectEnabled, true).value}
            onChange={noteLiteralHandlers.toggleEffect}
          />
        </div>

        {/* Y축 자동 보정 */}
        <div className="flex justify-between items-center w-full min-h-[32px]">
          <p className="text-fg-muted text-label">
            {t('keySetting.noteAutoYCorrection') || 'Y축 자동 보정'}
          </p>
          <Checkbox
            commitStrategy="after-paint"
            checked={
              getMixedValue((pos) => pos.noteAutoYCorrection, true).value
            }
            onChange={noteLiteralHandlers.toggleAutoYCorrection}
          />
        </div>
      </PropertySection>

      <PropertySection>
        {/* 오프셋 */}
        <PropertyRow label={t('keySetting.noteOffset') || '오프셋'}>
          <OptionalNumberInput
            value={
              getMixedValue((pos) => pos.noteOffsetX, 0).value || undefined
            }
            onChange={(value) =>
              handleBatchStyleChangeComplete('noteOffsetX', value)
            }
            prefix="X"
            width={AXIS_FIELD_WIDTH}
            allowNegative
            allowDecimal
            decimalScale={1}
            min={NOTE_SETTINGS_CONSTRAINTS.noteOffsetX.min}
            max={NOTE_SETTINGS_CONSTRAINTS.noteOffsetX.max}
            placeholder="0"
            isMixed={getMixedValue((pos) => pos.noteOffsetX, 0).isMixed}
          />
          <OptionalNumberInput
            value={
              getMixedValue((pos) => pos.noteOffsetY, 0).value || undefined
            }
            onChange={(value) =>
              handleBatchStyleChangeComplete('noteOffsetY', value)
            }
            prefix="Y"
            width={AXIS_FIELD_WIDTH}
            allowNegative
            allowDecimal
            decimalScale={1}
            min={NOTE_SETTINGS_CONSTRAINTS.noteOffsetY.min}
            max={NOTE_SETTINGS_CONSTRAINTS.noteOffsetY.max}
            placeholder="0"
            isMixed={getMixedValue((pos) => pos.noteOffsetY, 0).isMixed}
          />
        </PropertyRow>

        {/* 노트 넓이 */}
        <PropertyRow label={t('keySetting.noteWidth') || '노트 넓이'}>
          <OptionalNumberInput
            value={noteWidthMixed.value}
            onChange={(value) =>
              handleBatchStyleChangeComplete('noteWidth', value)
            }
            suffix="px"
            min={1}
            allowDecimal
            decimalScale={1}
            placeholder="Auto"
            isMixed={noteWidthMixed.isMixed}
          />
        </PropertyRow>

        {/* 노트 정렬 */}
        <PropertyRow label={t('keySetting.noteAlignment') || '노트 정렬'}>
          {getMixedValue((pos) => pos.noteAlignment, 'center').isMixed && (
            <span className="text-fg-faint text-body italic">Mixed</span>
          )}
          <Dropdown
            commitStrategy="after-paint"
            options={[
              {
                label: t('keySetting.noteAlignLeft') || '좌측',
                value: 'left',
              },
              {
                label: t('keySetting.noteAlignCenter') || '중앙',
                value: 'center',
              },
              {
                label: t('keySetting.noteAlignRight') || '우측',
                value: 'right',
              },
            ]}
            value={getMixedValue((pos) => pos.noteAlignment, 'center').value}
            onChange={(value) =>
              noteLiteralHandlers.setAlignment(
                value as 'left' | 'center' | 'right',
              )
            }
          />
        </PropertyRow>
      </PropertySection>

      <PropertySection>
        {/* 노트 색상 */}
        <PropertyRow label={t('keySetting.noteColor') || '노트 색상'}>
          <ColorSwatchButton
            ref={batchNoteColorButtonRef}
            onClick={onNoteColorPickerToggle}
            open={isNoteColorPickerOpen}
            className="w-[23px] h-[23px] rounded-md cursor-pointer transition-shadow flex-shrink-0"
            surfaceClassName="rounded-md"
            color={noteColorDisplay.color}
            gradient={noteColorDisplay.gradient}
            opacity={noteColorDisplay.opacity}
            title={noteColorDisplay.label}
            type="button"
          />
        </PropertyRow>

        {/* 테두리 색상 + 방향 */}
        <PropertyRow label={t('keySetting.noteBorderColor') || '테두리 색상'}>
          <div className="flex items-center gap-[4px]">
            <ColorSwatchButton
              ref={batchBorderColorButtonRef}
              type="button"
              onClick={onBorderColorPickerToggle}
              open={isBorderColorPickerOpen}
              className="w-[23px] h-[23px] rounded-md cursor-pointer transition-shadow flex-shrink-0"
              surfaceClassName="rounded-md"
              color={borderColorDisplay.color}
              opacity={borderColorDisplay.opacity}
              title={borderColorDisplay.label}
            />
            <Dropdown
              commitStrategy="after-paint"
              iconTrigger={
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                  {getMixedValue((pos) => pos.noteBorderSide, 'all').value ===
                    'all' && (
                    <rect
                      x="1.5"
                      y="1.5"
                      width="10"
                      height="10"
                      rx="1.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    />
                  )}
                  {getMixedValue((pos) => pos.noteBorderSide, 'all').value ===
                    'vertical' && (
                    <>
                      <line
                        x1="1.5"
                        y1="1"
                        x2="1.5"
                        y2="12"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                      <line
                        x1="11.5"
                        y1="1"
                        x2="11.5"
                        y2="12"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </>
                  )}
                  {getMixedValue((pos) => pos.noteBorderSide, 'all').value ===
                    'horizontal' && (
                    <>
                      <line
                        x1="1"
                        y1="1.5"
                        x2="12"
                        y2="1.5"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                      <line
                        x1="1"
                        y1="11.5"
                        x2="12"
                        y2="11.5"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </>
                  )}
                </svg>
              }
              align="right"
              options={[
                {
                  label: t('keySetting.borderSideAll') || '전체',
                  value: 'all',
                },
                {
                  label: t('keySetting.borderSideVertical') || '수직',
                  value: 'vertical',
                },
                {
                  label: t('keySetting.borderSideHorizontal') || '수평',
                  value: 'horizontal',
                },
              ]}
              value={getMixedValue((pos) => pos.noteBorderSide, 'all').value}
              onChange={(value) =>
                noteLiteralHandlers.setBorderSide(
                  value as 'all' | 'vertical' | 'horizontal',
                )
              }
            />
          </div>
        </PropertyRow>

        {/* 테두리 두께 */}
        <PropertyRow label={t('keySetting.noteBorderWidth') || '테두리 두께'}>
          <NumberInput
            value={
              getMixedValue(
                (pos) => pos.noteBorderWidth,
                NOTE_SETTINGS_CONSTRAINTS.noteBorderWidth.default,
              ).value
            }
            onChange={(value) =>
              handleBatchStyleChangeComplete('noteBorderWidth', value)
            }
            suffix="px"
            min={NOTE_SETTINGS_CONSTRAINTS.noteBorderWidth.min}
            max={NOTE_SETTINGS_CONSTRAINTS.noteBorderWidth.max}
            allowDecimal
            decimalScale={1}
            isMixed={
              getMixedValue(
                (pos) => pos.noteBorderWidth,
                NOTE_SETTINGS_CONSTRAINTS.noteBorderWidth.default,
              ).isMixed
            }
          />
        </PropertyRow>

        {/* 노트 라운딩 */}
        <PropertyRow label={t('keySetting.noteBorderRadius') || '노트 라운딩'}>
          <NumberInput
            value={
              getMixedValue(
                (pos) => pos.noteBorderRadius,
                NOTE_SETTINGS_CONSTRAINTS.borderRadius.default,
              ).value
            }
            onChange={(value) =>
              handleBatchStyleChangeComplete('noteBorderRadius', value)
            }
            suffix="px"
            min={NOTE_SETTINGS_CONSTRAINTS.borderRadius.min}
            max={NOTE_SETTINGS_CONSTRAINTS.borderRadius.max}
            allowDecimal
            decimalScale={1}
            isMixed={
              getMixedValue(
                (pos) => pos.noteBorderRadius,
                NOTE_SETTINGS_CONSTRAINTS.borderRadius.default,
              ).isMixed
            }
          />
        </PropertyRow>
      </PropertySection>

      <PropertySection>
        {/* 글로우 효과 */}
        <div className="flex justify-between items-center w-full min-h-[32px]">
          <p className="text-fg-muted text-label">
            {t('keySetting.noteGlow') || '글로우 효과'}
          </p>
          <Checkbox
            commitStrategy="after-paint"
            checked={getMixedValue((pos) => pos.noteGlowEnabled, false).value}
            onChange={noteLiteralHandlers.toggleGlow}
          />
        </div>

        {/* 글로우 색상 */}
        <PropertyRow label={t('keySetting.noteGlowColor') || '글로우 색상'}>
          <ColorSwatchButton
            ref={batchGlowColorButtonRef}
            onClick={onGlowColorPickerToggle}
            open={isGlowColorPickerOpen}
            className="w-[23px] h-[23px] rounded-md cursor-pointer transition-shadow flex-shrink-0"
            surfaceClassName="rounded-md"
            color={glowColorDisplay.color}
            gradient={glowColorDisplay.gradient}
            opacity={glowColorDisplay.opacity}
            title={glowColorDisplay.label}
            type="button"
          />
        </PropertyRow>

        {/* 글로우 크기 */}
        <PropertyRow label={t('keySetting.noteGlowSize') || '글로우 크기'}>
          <NumberInput
            value={getMixedValue((pos) => pos.noteGlowSize, 20).value}
            onChange={(value) =>
              handleBatchStyleChangeComplete('noteGlowSize', value)
            }
            suffix="px"
            min={0}
            max={50}
            allowDecimal
            decimalScale={1}
            isMixed={getMixedValue((pos) => pos.noteGlowSize, 20).isMixed}
          />
        </PropertyRow>
      </PropertySection>
    </>
  );
};

export default BatchNoteTabContent;
