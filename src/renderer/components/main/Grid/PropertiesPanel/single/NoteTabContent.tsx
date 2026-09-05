import React from 'react';
import type { NoteTabContentProps } from '../types';
import type { NoteColor } from '@src/types/key/keys';
import {
  PropertyRow,
  PropertySection,
  NumberInput,
  OptionalNumberInput,
} from '../controls/PropertyInputs';
import Checkbox from '@components/main/common/checkbox/Checkbox';
import Dropdown from '@components/main/common/dropdown/Dropdown';
import ColorPicker from '@components/main/Modal/content/pickers/color/ColorPicker';
import PopupExit from '@components/main/Modal/PopupExit';
import {
  parseAlphaPercent,
  hexWithAlphaPercent,
} from '@utils/color/colorUtils';
import { gradientToCss } from '@src/types/color';
import { toNoteHexColor } from '../selection/notePaintColorUtils';
import { NOTE_SETTINGS_CONSTRAINTS } from '@src/types/settings/noteSettingsConstraints';
import { useSettingsStore } from '@stores/useSettingsStore';
import { ColorSwatchButton } from '@components/main/Modal/content/pickers/color/ColorSwatch';
import { editGestureController } from '@src/renderer/editor/runtime/gesture/editGestureController';
import { AXIS_FIELD_WIDTH } from '@utils/cardRecipes';
import NoteGlowPaintSourceDropdown from '../controls/NoteGlowPaintSourceDropdown';
import { useSingleNotePaint } from './useSingleNotePaint';

const NoteTabContent: React.FC<NoteTabContentProps> = ({
  keyPosition,
  canonicalKeyPosition = keyPosition,
  onElementPropertyCommit,
  onStylePropertyPreview,
  onStylePropertyCommit,
  onNotePaintPreview,
  onNotePaintCommit,
  panelElement,
  t,
}) => {
  const { noteEffect: _noteEffect } = useSettingsStore();

  const {
    pickerFor,
    setPickerFor,
    pickerOpen,
    noteColorButtonRef,
    glowColorButtonRef,
    borderColorButtonRef,
    noteSolidColor,
    setNoteSolidColor,
    glowSolidColor,
    setGlowSolidColor,
    localNoteOpacity,
    setLocalNoteOpacity,
    localGlowOpacity,
    setLocalGlowOpacity,
    borderColor,
    setBorderColor,
    localBorderOpacity,
    setLocalBorderOpacity,
    storedBorderGradient,
    borderGradientState,
    interactiveRefs,
    storedNoteSpec,
    storedGlowSpec,
    glowPaintLocked,
    activePaintState,
    restoreCanonicalOpacity,
    handlePickerToggle,
    noteLiteralHandlers,
    setGlowPaintFollow,
  } = useSingleNotePaint({
    keyPosition,
    canonicalKeyPosition,
    onElementPropertyCommit,
    onNotePaintPreview,
    onNotePaintCommit,
  });

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
            checked={keyPosition.noteEffectEnabled ?? true}
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
            checked={keyPosition.noteAutoYCorrection ?? true}
            onChange={noteLiteralHandlers.toggleAutoYCorrection}
          />
        </div>
      </PropertySection>

      <PropertySection>
        {/* 오프셋 */}
        <PropertyRow label={t('keySetting.noteOffset') || '오프셋'}>
          <OptionalNumberInput
            value={keyPosition.noteOffsetX || undefined}
            onChange={(value) => {
              onStylePropertyCommit?.({
                property: 'noteOffsetX',
                value: value ?? null,
              });
            }}
            onPreview={(value) => {
              onStylePropertyPreview?.({
                property: 'noteOffsetX',
                value: value ?? null,
              });
            }}
            onCancel={() => editGestureController.cancel()}
            prefix="X"
            width={AXIS_FIELD_WIDTH}
            allowNegative
            allowDecimal
            decimalScale={1}
            min={NOTE_SETTINGS_CONSTRAINTS.noteOffsetX.min}
            max={NOTE_SETTINGS_CONSTRAINTS.noteOffsetX.max}
            placeholder="0"
          />
          <OptionalNumberInput
            value={keyPosition.noteOffsetY || undefined}
            onChange={(value) => {
              onStylePropertyCommit?.({
                property: 'noteOffsetY',
                value: value ?? null,
              });
            }}
            onPreview={(value) => {
              onStylePropertyPreview?.({
                property: 'noteOffsetY',
                value: value ?? null,
              });
            }}
            onCancel={() => editGestureController.cancel()}
            prefix="Y"
            width={AXIS_FIELD_WIDTH}
            allowNegative
            allowDecimal
            decimalScale={1}
            min={NOTE_SETTINGS_CONSTRAINTS.noteOffsetY.min}
            max={NOTE_SETTINGS_CONSTRAINTS.noteOffsetY.max}
            placeholder="0"
          />
        </PropertyRow>

        {/* 노트 넓이 */}
        <PropertyRow label={t('keySetting.noteWidth') || '노트 넓이'}>
          <OptionalNumberInput
            value={keyPosition.noteWidth}
            onChange={(value) => {
              onStylePropertyCommit?.({
                property: 'noteWidth',
                value: value ?? null,
              });
            }}
            onPreview={(value) => {
              onStylePropertyPreview?.({
                property: 'noteWidth',
                value: value ?? null,
              });
            }}
            onCancel={() => editGestureController.cancel()}
            suffix="px"
            min={1}
            allowDecimal
            decimalScale={1}
            placeholder={`${keyPosition.width}px`}
          />
        </PropertyRow>

        {/* 노트 정렬 */}
        <PropertyRow label={t('keySetting.noteAlignment') || '노트 정렬'}>
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
            value={keyPosition.noteAlignment ?? 'center'}
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
            ref={noteColorButtonRef}
            type="button"
            onClick={() => handlePickerToggle('note')}
            open={pickerFor === 'note'}
            className="w-[23px] h-[23px] rounded-md cursor-pointer transition-shadow flex-shrink-0"
            surfaceClassName="rounded-md"
            color={storedNoteSpec ? undefined : noteSolidColor}
            image={storedNoteSpec ? gradientToCss(storedNoteSpec) : undefined}
            // 그라데이션은 알파가 이미지에 실려 있어 배율을 곱하지 않는다
            opacity={storedNoteSpec ? undefined : localNoteOpacity / 100}
          />
        </PropertyRow>

        {/* 노트 테두리 색상 + 방향 */}
        <PropertyRow label={t('keySetting.noteBorderColor') || '테두리 색상'}>
          <div className="flex items-center gap-[4px]">
            <ColorSwatchButton
              ref={borderColorButtonRef}
              type="button"
              onClick={() => handlePickerToggle('border')}
              open={pickerFor === 'border'}
              className="w-[23px] h-[23px] rounded-md cursor-pointer transition-shadow flex-shrink-0"
              surfaceClassName="rounded-md"
              color={borderColor}
              image={
                storedBorderGradient
                  ? gradientToCss(storedBorderGradient)
                  : undefined
              }
              opacity={
                storedBorderGradient ? undefined : localBorderOpacity / 100
              }
            />
            <Dropdown
              commitStrategy="after-paint"
              iconTrigger={
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                  {(keyPosition.noteBorderSide ?? 'all') === 'all' && (
                    <rect
                      x="1.5"
                      y="1.5"
                      width="10"
                      height="10"
                      rx="1.5"
                      stroke="currentColor"
                      strokeWidth="1.2"
                    />
                  )}
                  {(keyPosition.noteBorderSide ?? 'all') === 'vertical' && (
                    <>
                      <line
                        x1="1.5"
                        y1="1"
                        x2="1.5"
                        y2="12"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                      />
                      <line
                        x1="11.5"
                        y1="1"
                        x2="11.5"
                        y2="12"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                      />
                    </>
                  )}
                  {(keyPosition.noteBorderSide ?? 'all') === 'horizontal' && (
                    <>
                      <line
                        x1="1"
                        y1="1.5"
                        x2="12"
                        y2="1.5"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                      />
                      <line
                        x1="1"
                        y1="11.5"
                        x2="12"
                        y2="11.5"
                        stroke="currentColor"
                        strokeWidth="1.2"
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
              value={keyPosition.noteBorderSide ?? 'all'}
              onChange={(value) =>
                noteLiteralHandlers.setBorderSide(
                  value as 'all' | 'vertical' | 'horizontal',
                )
              }
            />
          </div>
        </PropertyRow>

        {/* 노트 테두리 두께 */}
        <PropertyRow label={t('keySetting.noteBorderWidth') || '테두리 두께'}>
          <NumberInput
            value={
              keyPosition.noteBorderWidth ??
              NOTE_SETTINGS_CONSTRAINTS.noteBorderWidth.default
            }
            onChange={(value) =>
              onStylePropertyCommit?.({
                property: 'noteBorderWidth',
                value: value,
              })
            }
            onPreview={(value) =>
              onStylePropertyPreview?.({
                property: 'noteBorderWidth',
                value: value,
              })
            }
            onCancel={() => editGestureController.cancel()}
            suffix="px"
            min={NOTE_SETTINGS_CONSTRAINTS.noteBorderWidth.min}
            max={NOTE_SETTINGS_CONSTRAINTS.noteBorderWidth.max}
            allowDecimal
            decimalScale={1}
          />
        </PropertyRow>

        {/* 노트 라운딩 */}
        <PropertyRow label={t('keySetting.noteBorderRadius') || '노트 라운딩'}>
          <NumberInput
            value={
              keyPosition.noteBorderRadius ??
              NOTE_SETTINGS_CONSTRAINTS.borderRadius.default
            }
            onChange={(value) =>
              onStylePropertyCommit?.({
                property: 'noteBorderRadius',
                value: value,
              })
            }
            onPreview={(value) =>
              onStylePropertyPreview?.({
                property: 'noteBorderRadius',
                value: value,
              })
            }
            onCancel={() => editGestureController.cancel()}
            suffix="px"
            min={NOTE_SETTINGS_CONSTRAINTS.borderRadius.min}
            max={NOTE_SETTINGS_CONSTRAINTS.borderRadius.max}
            allowDecimal
            decimalScale={1}
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
            checked={keyPosition.noteGlowEnabled ?? false}
            onChange={noteLiteralHandlers.toggleGlow}
          />
        </div>

        {/* 글로우 색상/크기/투명도 */}
        <PropertyRow label={t('keySetting.noteGlowColor') || '글로우 색상'}>
          <div className="flex items-center gap-[4px]">
            <ColorSwatchButton
              ref={glowColorButtonRef}
              type="button"
              onClick={() => handlePickerToggle('glow')}
              open={pickerFor === 'glow'}
              disabled={glowPaintLocked}
              className={`w-[23px] h-[23px] rounded-md transition-shadow flex-shrink-0 ${
                glowPaintLocked
                  ? 'cursor-not-allowed opacity-50'
                  : 'cursor-pointer'
              }`}
              surfaceClassName="rounded-md"
              color={storedGlowSpec ? undefined : glowSolidColor}
              image={storedGlowSpec ? gradientToCss(storedGlowSpec) : undefined}
              opacity={storedGlowSpec ? undefined : localGlowOpacity / 100}
            />
            <NoteGlowPaintSourceDropdown
              follow={glowPaintLocked}
              onChange={setGlowPaintFollow}
              t={t}
            />
          </div>
        </PropertyRow>

        <PropertyRow label={t('keySetting.noteGlowSize') || '글로우 크기'}>
          <NumberInput
            value={keyPosition.noteGlowSize ?? 20}
            onChange={(value) => {
              onStylePropertyCommit?.({
                property: 'noteGlowSize',
                value: value,
              });
            }}
            onPreview={(value) => {
              onStylePropertyPreview?.({
                property: 'noteGlowSize',
                value: value,
              });
            }}
            onCancel={() => editGestureController.cancel()}
            suffix="px"
            min={0}
            max={50}
            allowDecimal
            decimalScale={1}
          />
        </PropertyRow>
      </PropertySection>

      {/* 통합 ColorPicker - 단일 인스턴스로 깜빡임 없이 전환 */}
      <PopupExit open={pickerOpen}>
        {pickerFor ? (
          <ColorPicker
            open={pickerOpen}
            referenceRef={
              pickerFor === 'note'
                ? noteColorButtonRef
                : pickerFor === 'glow'
                ? glowColorButtonRef
                : borderColorButtonRef
            }
            panelElement={panelElement}
            color={
              pickerFor === 'border' &&
              borderGradientState.format !== 'gradient'
                ? hexWithAlphaPercent(borderColor, localBorderOpacity)
                : activePaintState.pickerColor
            }
            onColorChange={(c: NoteColor) => {
              if (typeof c !== 'string') return;
              if (
                pickerFor === 'border' &&
                borderGradientState.format !== 'gradient'
              ) {
                // 보더 단색은 색 알파가 투명도를 겸하는 기존 규약 유지
                const hex = toNoteHexColor(c);
                const opacity = parseAlphaPercent(c, localBorderOpacity);
                setBorderColor(hex);
                setLocalBorderOpacity(opacity);
                onNotePaintPreview?.({
                  property: 'noteBorderPaint',
                  value: { color: hex, opacity },
                });
                return;
              }
              activePaintState.handlePickerColorChange(c, false);
            }}
            onColorChangeComplete={(c: NoteColor) => {
              if (typeof c !== 'string') return;
              if (
                pickerFor === 'border' &&
                borderGradientState.format !== 'gradient'
              ) {
                const hex = toNoteHexColor(c);
                const opacity = parseAlphaPercent(c, localBorderOpacity);
                setBorderColor(hex);
                setLocalBorderOpacity(opacity);
                const patch = {
                  property: 'noteBorderPaint',
                  value: { color: hex, opacity },
                } as const;
                onNotePaintCommit?.(patch);
                return;
              }
              activePaintState.handlePickerColorChange(c, true);
            }}
            onInputCancel={(_target, restoredColor) => {
              activePaintState.cancelPreview();
              if (typeof restoredColor === 'string') {
                if (pickerFor === 'border') {
                  setBorderColor(toNoteHexColor(restoredColor));
                  setLocalBorderOpacity(
                    parseAlphaPercent(restoredColor, localBorderOpacity),
                  );
                } else if (pickerFor === 'note') {
                  setNoteSolidColor(toNoteHexColor(restoredColor));
                } else {
                  setGlowSolidColor(toNoteHexColor(restoredColor));
                }
              }
              editGestureController.cancel();
            }}
            onClose={() => setPickerFor(null)}
            interactiveRefs={interactiveRefs}
            solidOnly={true}
            headerSlot={activePaintState.headerSlot}
            footerSlot={activePaintState.footerSlot}
            gradientSpec={activePaintState.paletteGradientSpec}
            onGradientSpecSelect={activePaintState.handleGradientSpecSelect}
            {...(pickerFor !== 'border' &&
            activePaintState.format !== 'gradient'
              ? {
                  // 단색 형식: 투명도 조절기가 알파를 대신하고 기존 3필드 동일값
                  // 커밋을 유지한다. 색 알파는 저장 시 hex 변환으로 버려지므로 숨긴다.
                  // 그라데이션 형식은 스톱 알파만 편집하므로 조절기를 두지 않는다
                  hideColorAlpha: true,
                  opacityPercent:
                    pickerFor === 'note' ? localNoteOpacity : localGlowOpacity,
                  onOpacityPercentChange: (value: number) => {
                    const surface = pickerFor === 'note' ? 'note' : 'glow';
                    if (surface === 'glow' && glowPaintLocked) return;
                    if (surface === 'note') {
                      setLocalNoteOpacity(value);
                    } else {
                      setLocalGlowOpacity(value);
                    }
                    onNotePaintPreview?.({
                      property:
                        surface === 'note' ? 'notePaint' : 'noteGlowPaint',
                      value: {
                        opacity: value,
                        opacityTop: value,
                        opacityBottom: value,
                      },
                    });
                  },
                  onOpacityPercentChangeComplete: (value: number) => {
                    const surface = pickerFor === 'note' ? 'note' : 'glow';
                    if (surface === 'glow' && glowPaintLocked) return;
                    const property =
                      surface === 'note' ? 'notePaint' : 'noteGlowPaint';
                    if (surface === 'note') {
                      setLocalNoteOpacity(value);
                    } else {
                      setLocalGlowOpacity(value);
                    }
                    const patch = {
                      property,
                      value: {
                        opacity: value,
                        opacityTop: value,
                        opacityBottom: value,
                      },
                    } as const;
                    onNotePaintCommit?.(patch);
                  },
                  onOpacityPercentCancel: () => {
                    restoreCanonicalOpacity(
                      pickerFor === 'note' ? 'note' : 'glow',
                    );
                    editGestureController.cancel();
                  },
                  opacityPercentLabel:
                    pickerFor === 'note'
                      ? t('keySetting.noteOpacity') || '노트 투명도'
                      : t('keySetting.noteGlowOpacity') || '글로우 투명도',
                }
              : {})}
          />
        ) : null}
      </PopupExit>
    </>
  );
};

export default NoteTabContent;
