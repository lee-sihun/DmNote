/* eslint-disable react-hooks/set-state-in-effect */
import React, { useEffect, useRef, useState } from 'react';
import type { NoteTabContentProps } from '../types';
import type { NoteColor, KeyPosition } from '@src/types/key/keys';
import {
  PropertyRow,
  PropertySection,
  NumberInput,
  OptionalNumberInput,
} from '../PropertyInputs';
import Checkbox from '@components/main/common/Checkbox';
import Dropdown from '@components/main/common/Dropdown';
import ColorPicker from '@components/main/Modal/content/pickers/ColorPicker';
import {
  isGradientColor,
  toRgbHexColor,
  parseAlphaPercent,
  hexWithAlphaPercent,
} from '@utils/color/colorUtils';
import { NOTE_SETTINGS_CONSTRAINTS } from '@src/types/settings/noteSettingsConstraints';
import { useSettingsStore } from '@stores/useSettingsStore';
import { ColorSwatchButton } from '@components/main/Modal/content/pickers/ColorSwatch';
import { editGestureController } from '@src/renderer/editor/runtime/editGestureController';

const DEFAULT_NOTE_COLOR = '#FFFFFF';

// 색상 모드 상수
const COLOR_MODES = {
  solid: 'solid',
  gradient: 'gradient',
} as const;

type ColorMode = (typeof COLOR_MODES)[keyof typeof COLOR_MODES];

// 그라디언트 객체 생성 헬퍼
const toGradient = (top: string, bottom: string) => ({
  type: 'gradient' as const,
  top,
  bottom,
});

const NoteTabContent: React.FC<NoteTabContentProps> = ({
  keyIndex,
  keyPosition,
  onKeyUpdate,
  onKeyPreview,
  panelElement,
  t,
}) => {
  const { noteEffect: _noteEffect } = useSettingsStore();

  // 통합 피커 상태 (카운터 탭 패턴)
  type PickerTarget = 'note' | 'glow' | 'border' | null;
  const [pickerFor, setPickerFor] = useState<PickerTarget>(null);
  const pickerOpen = !!pickerFor;

  // 컬러 버튼 refs
  const noteColorButtonRef = useRef<HTMLButtonElement>(null);
  const glowColorButtonRef = useRef<HTMLButtonElement>(null);
  const borderColorButtonRef = useRef<HTMLButtonElement>(null);

  // 노트 색상 상태 (원본 모달과 동일한 패턴)
  const [noteColorMode, setNoteColorMode] = useState<ColorMode>(() => {
    const noteColor = keyPosition.noteColor;
    return isGradientColor(noteColor)
      ? COLOR_MODES.gradient
      : COLOR_MODES.solid;
  });
  const [noteColorTop, setNoteColorTop] = useState<string>(() => {
    const noteColor = keyPosition.noteColor;
    if (
      noteColor &&
      typeof noteColor === 'object' &&
      noteColor.type === 'gradient'
    ) {
      return noteColor.top;
    }
    return typeof noteColor === 'string' ? noteColor : DEFAULT_NOTE_COLOR;
  });
  const [noteGradientBottom, setNoteGradientBottom] = useState<string>(() => {
    const noteColor = keyPosition.noteColor;
    if (
      noteColor &&
      typeof noteColor === 'object' &&
      noteColor.type === 'gradient'
    ) {
      return noteColor.bottom;
    }
    return typeof noteColor === 'string' ? noteColor : DEFAULT_NOTE_COLOR;
  });

  // 글로우 색상 상태 (원본 모달과 동일한 패턴)
  const [glowColorMode, setGlowColorMode] = useState<ColorMode>(() => {
    const glowColor = keyPosition.noteGlowColor ?? keyPosition.noteColor;
    return isGradientColor(glowColor)
      ? COLOR_MODES.gradient
      : COLOR_MODES.solid;
  });
  const [glowColorTop, setGlowColorTop] = useState<string>(() => {
    const glowColor = keyPosition.noteGlowColor ?? keyPosition.noteColor;
    if (
      glowColor &&
      typeof glowColor === 'object' &&
      glowColor.type === 'gradient'
    ) {
      return glowColor.top;
    }
    return typeof glowColor === 'string' ? glowColor : DEFAULT_NOTE_COLOR;
  });
  const [glowGradientBottom, setGlowGradientBottom] = useState<string>(() => {
    const glowColor = keyPosition.noteGlowColor ?? keyPosition.noteColor;
    if (
      glowColor &&
      typeof glowColor === 'object' &&
      glowColor.type === 'gradient'
    ) {
      return glowColor.bottom;
    }
    return typeof glowColor === 'string' ? glowColor : DEFAULT_NOTE_COLOR;
  });

  const [localNoteOpacity, setLocalNoteOpacity] = useState<number>(() =>
    typeof keyPosition.noteOpacity === 'number' ? keyPosition.noteOpacity : 80,
  );
  const [localNoteOpacityTop, setLocalNoteOpacityTop] = useState<number>(() => {
    const base =
      typeof keyPosition.noteOpacity === 'number'
        ? keyPosition.noteOpacity
        : 80;
    return typeof keyPosition.noteOpacityTop === 'number'
      ? keyPosition.noteOpacityTop
      : base;
  });
  const [localNoteOpacityBottom, setLocalNoteOpacityBottom] = useState<number>(
    () => {
      const base =
        typeof keyPosition.noteOpacity === 'number'
          ? keyPosition.noteOpacity
          : 80;
      return typeof keyPosition.noteOpacityBottom === 'number'
        ? keyPosition.noteOpacityBottom
        : base;
    },
  );
  const [localGlowOpacity, setLocalGlowOpacity] = useState<number>(() =>
    typeof keyPosition.noteGlowOpacity === 'number'
      ? keyPosition.noteGlowOpacity
      : 70,
  );
  const [localGlowOpacityTop, setLocalGlowOpacityTop] = useState<number>(() => {
    const base =
      typeof keyPosition.noteGlowOpacity === 'number'
        ? keyPosition.noteGlowOpacity
        : 70;
    return typeof keyPosition.noteGlowOpacityTop === 'number'
      ? keyPosition.noteGlowOpacityTop
      : base;
  });
  const [localGlowOpacityBottom, setLocalGlowOpacityBottom] = useState<number>(
    () => {
      const base =
        typeof keyPosition.noteGlowOpacity === 'number'
          ? keyPosition.noteGlowOpacity
          : 70;
      return typeof keyPosition.noteGlowOpacityBottom === 'number'
        ? keyPosition.noteGlowOpacityBottom
        : base;
    },
  );

  // keyPosition 변경 시 내부 상태 동기화 (피커가 닫혀있을 때만)
  useEffect(() => {
    // 피커가 열려있으면 외부 변경을 무시 (드래그 중 충돌 방지)
    if (pickerFor === 'note') return;

    const noteColor = keyPosition.noteColor;
    if (
      noteColor &&
      typeof noteColor === 'object' &&
      noteColor.type === 'gradient'
    ) {
      setNoteColorMode(COLOR_MODES.gradient);
      setNoteColorTop(noteColor.top);
      setNoteGradientBottom(noteColor.bottom);
    } else {
      setNoteColorMode(COLOR_MODES.solid);
      const color =
        typeof noteColor === 'string' ? noteColor : DEFAULT_NOTE_COLOR;
      setNoteColorTop(color);
      setNoteGradientBottom(color);
    }
  }, [keyPosition.noteColor, pickerFor]);

  useEffect(() => {
    // 피커가 열려있으면 외부 변경을 무시 (드래그 중 충돌 방지)
    if (pickerFor === 'glow') return;

    const glowColor = keyPosition.noteGlowColor ?? keyPosition.noteColor;
    if (
      glowColor &&
      typeof glowColor === 'object' &&
      glowColor.type === 'gradient'
    ) {
      setGlowColorMode(COLOR_MODES.gradient);
      setGlowColorTop(glowColor.top);
      setGlowGradientBottom(glowColor.bottom);
    } else {
      setGlowColorMode(COLOR_MODES.solid);
      const color =
        typeof glowColor === 'string' ? glowColor : DEFAULT_NOTE_COLOR;
      setGlowColorTop(color);
      setGlowGradientBottom(color);
    }
  }, [keyPosition.noteGlowColor, keyPosition.noteColor, pickerFor]);

  useEffect(() => {
    if (pickerFor === 'note') return;
    const base =
      typeof keyPosition.noteOpacity === 'number'
        ? keyPosition.noteOpacity
        : 80;
    setLocalNoteOpacity(base);
    setLocalNoteOpacityTop(
      typeof keyPosition.noteOpacityTop === 'number'
        ? keyPosition.noteOpacityTop
        : base,
    );
    setLocalNoteOpacityBottom(
      typeof keyPosition.noteOpacityBottom === 'number'
        ? keyPosition.noteOpacityBottom
        : base,
    );
  }, [
    keyPosition.noteOpacity,
    keyPosition.noteOpacityTop,
    keyPosition.noteOpacityBottom,
    pickerFor,
  ]);

  useEffect(() => {
    if (pickerFor === 'glow') return;
    const base =
      typeof keyPosition.noteGlowOpacity === 'number'
        ? keyPosition.noteGlowOpacity
        : 70;
    setLocalGlowOpacity(base);
    setLocalGlowOpacityTop(
      typeof keyPosition.noteGlowOpacityTop === 'number'
        ? keyPosition.noteGlowOpacityTop
        : base,
    );
    setLocalGlowOpacityBottom(
      typeof keyPosition.noteGlowOpacityBottom === 'number'
        ? keyPosition.noteGlowOpacityBottom
        : base,
    );
  }, [
    keyPosition.noteGlowOpacity,
    keyPosition.noteGlowOpacityTop,
    keyPosition.noteGlowOpacityBottom,
    pickerFor,
  ]);

  // 테두리 색상 상태
  const [borderColor, setBorderColor] = useState<string>(
    () => keyPosition.noteBorderColor ?? '#FFFFFF',
  );
  // 테두리 투명도(0~100). 노트 배경 투명도와 독립
  const [localBorderOpacity, setLocalBorderOpacity] = useState<number>(
    () => keyPosition.noteBorderOpacity ?? 100,
  );

  useEffect(() => {
    if (pickerFor === 'border') return;
    setBorderColor(keyPosition.noteBorderColor ?? '#FFFFFF');
    setLocalBorderOpacity(keyPosition.noteBorderOpacity ?? 100);
  }, [keyPosition.noteBorderColor, keyPosition.noteBorderOpacity, pickerFor]);

  const interactiveRefs = [
    noteColorButtonRef,
    glowColorButtonRef,
    borderColorButtonRef,
  ];

  // 통합 색상 변경 핸들러 (pickerFor 기반)
  const handleColorChange = (target: 'note' | 'glow', newColor: NoteColor) => {
    if (target === 'note') {
      if (
        newColor &&
        typeof newColor === 'object' &&
        newColor.type === 'gradient'
      ) {
        setNoteColorMode(COLOR_MODES.gradient);
        setNoteColorTop(newColor.top);
        setNoteGradientBottom(newColor.bottom);
      } else {
        const solidColor = newColor as string;
        setNoteColorMode(COLOR_MODES.solid);
        setNoteColorTop(solidColor);
        setNoteGradientBottom(solidColor);
      }
    } else {
      if (
        newColor &&
        typeof newColor === 'object' &&
        newColor.type === 'gradient'
      ) {
        setGlowColorMode(COLOR_MODES.gradient);
        setGlowColorTop(newColor.top);
        setGlowGradientBottom(newColor.bottom);
      } else {
        const solidColor = newColor as string;
        setGlowColorMode(COLOR_MODES.solid);
        setGlowColorTop(solidColor);
        setGlowGradientBottom(solidColor);
      }
    }
  };

  const handleColorChangeComplete = (
    target: 'note' | 'glow',
    newColor: NoteColor,
  ) => {
    let colorValue: NoteColor;

    if (target === 'note') {
      if (
        newColor &&
        typeof newColor === 'object' &&
        newColor.type === 'gradient'
      ) {
        setNoteColorMode(COLOR_MODES.gradient);
        setNoteColorTop(newColor.top);
        setNoteGradientBottom(newColor.bottom);
        colorValue = {
          type: 'gradient',
          top: newColor.top,
          bottom: newColor.bottom,
        };
      } else {
        const solidColor = newColor as string;
        setNoteColorMode(COLOR_MODES.solid);
        setNoteColorTop(solidColor);
        setNoteGradientBottom(solidColor);
        colorValue = newColor;
      }
      onKeyPreview?.(keyIndex, { noteColor: colorValue });
      onKeyUpdate({ index: keyIndex, noteColor: colorValue });
    } else {
      if (
        newColor &&
        typeof newColor === 'object' &&
        newColor.type === 'gradient'
      ) {
        setGlowColorMode(COLOR_MODES.gradient);
        setGlowColorTop(newColor.top);
        setGlowGradientBottom(newColor.bottom);
        colorValue = {
          type: 'gradient',
          top: newColor.top,
          bottom: newColor.bottom,
        };
      } else {
        const solidColor = newColor as string;
        setGlowColorMode(COLOR_MODES.solid);
        setGlowColorTop(solidColor);
        setGlowGradientBottom(solidColor);
        colorValue = newColor;
      }
      onKeyPreview?.(keyIndex, { noteGlowColor: colorValue });
      onKeyUpdate({ index: keyIndex, noteGlowColor: colorValue });
    }
  };

  // ColorPicker에 전달할 색상 (내부 상태 기반)
  const notePickerColor = (() => {
    if (noteColorMode === COLOR_MODES.gradient) {
      return toGradient(noteColorTop, noteGradientBottom);
    }
    return noteColorTop;
  })();

  const glowPickerColor = (() => {
    if (glowColorMode === COLOR_MODES.gradient) {
      return toGradient(glowColorTop, glowGradientBottom);
    }
    return glowColorTop;
  })();

  // 피커 토글 (같은 타겟이면 닫고, 다른 타겟이면 바로 전환)
  const handlePickerToggle = (target: 'note' | 'glow' | 'border') => {
    setPickerFor((prev) => (prev === target ? null : target));
  };

  // 스타일 변경 완료 핸들러
  const handleStyleChangeComplete = (
    property: keyof KeyPosition,
    value: KeyPosition[keyof KeyPosition],
  ) => {
    onKeyUpdate({ index: keyIndex, [property]: value });
  };

  // 타이핑 중 스타일 프리뷰
  const handleStylePreview = (
    property: keyof KeyPosition,
    value: KeyPosition[keyof KeyPosition],
  ) => {
    onKeyPreview?.(keyIndex, { [property]: value });
  };

  return (
    <>
      <PropertySection>
        {/* 노트 효과 표시 */}
        <div className="flex justify-between items-center w-full min-h-[32px]">
          <p className="text-fg-muted text-label">
            {t('keySetting.noteEffectEnabled') || '노트 효과 표시'}
          </p>
          <Checkbox
            checked={keyPosition.noteEffectEnabled ?? true}
            onChange={() =>
              handleStyleChangeComplete(
                'noteEffectEnabled',
                !(keyPosition.noteEffectEnabled ?? true),
              )
            }
          />
        </div>

        {/* Y축 자동 보정 */}
        <div className="flex justify-between items-center w-full min-h-[32px]">
          <p className="text-fg-muted text-label">
            {t('keySetting.noteAutoYCorrection') || 'Y축 자동 보정'}
          </p>
          <Checkbox
            checked={keyPosition.noteAutoYCorrection ?? true}
            onChange={() =>
              handleStyleChangeComplete(
                'noteAutoYCorrection',
                !(keyPosition.noteAutoYCorrection ?? true),
              )
            }
          />
        </div>
      </PropertySection>

      <PropertySection>
        {/* 오프셋 */}
        <PropertyRow label={t('keySetting.noteOffset') || '오프셋'}>
          <OptionalNumberInput
            value={keyPosition.noteOffsetX || undefined}
            onChange={(value) =>
              handleStyleChangeComplete('noteOffsetX', value)
            }
            onPreview={(value) => handleStylePreview('noteOffsetX', value)}
            onCancel={() => editGestureController.cancel()}
            prefix="X"
            allowNegative
            allowDecimal
            decimalScale={1}
            min={NOTE_SETTINGS_CONSTRAINTS.noteOffsetX.min}
            max={NOTE_SETTINGS_CONSTRAINTS.noteOffsetX.max}
            placeholder="0"
          />
          <OptionalNumberInput
            value={keyPosition.noteOffsetY || undefined}
            onChange={(value) =>
              handleStyleChangeComplete('noteOffsetY', value)
            }
            onPreview={(value) => handleStylePreview('noteOffsetY', value)}
            onCancel={() => editGestureController.cancel()}
            prefix="Y"
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
            onChange={(value) => handleStyleChangeComplete('noteWidth', value)}
            onPreview={(value) => handleStylePreview('noteWidth', value)}
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
              handleStyleChangeComplete(
                'noteAlignment',
                value as 'left' | 'center' | 'right',
              )
            }
          />
        </PropertyRow>

        {/* 노트 진행 방향 (미설정 = 전역·탭 설정 상속) */}
        <PropertyRow label={t('keySetting.noteDirection') || '노트 방향'}>
          <Dropdown
            options={[
              {
                label: t('keySetting.noteDirectionInherit') || '설정 따름',
                value: 'inherit',
              },
              { label: t('noteSetting.directionUp') || '위', value: 'up' },
              {
                label: t('noteSetting.directionDown') || '아래',
                value: 'down',
              },
              {
                label: t('noteSetting.directionLeft') || '왼쪽',
                value: 'left',
              },
              {
                label: t('noteSetting.directionRight') || '오른쪽',
                value: 'right',
              },
            ]}
            value={keyPosition.noteDirection ?? 'inherit'}
            onChange={(value) =>
              handleStyleChangeComplete(
                'noteDirection',
                value === 'inherit'
                  ? undefined
                  : (value as 'up' | 'down' | 'left' | 'right'),
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
            color={
              noteColorMode === COLOR_MODES.solid ? noteColorTop : undefined
            }
            gradient={
              noteColorMode === COLOR_MODES.gradient
                ? { top: noteColorTop, bottom: noteGradientBottom }
                : undefined
            }
            opacity={
              noteColorMode === COLOR_MODES.gradient
                ? {
                    top: localNoteOpacityTop / 100,
                    bottom: localNoteOpacityBottom / 100,
                  }
                : localNoteOpacity / 100
            }
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
              opacity={localBorderOpacity / 100}
            />
            <Dropdown
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
                      strokeWidth="1.5"
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
                  {(keyPosition.noteBorderSide ?? 'all') === 'horizontal' && (
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
              value={keyPosition.noteBorderSide ?? 'all'}
              onChange={(value) =>
                handleStyleChangeComplete(
                  'noteBorderSide',
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
              handleStyleChangeComplete('noteBorderWidth', value)
            }
            onPreview={(value) => handleStylePreview('noteBorderWidth', value)}
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
              handleStyleChangeComplete('noteBorderRadius', value)
            }
            onPreview={(value) => handleStylePreview('noteBorderRadius', value)}
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
            checked={keyPosition.noteGlowEnabled ?? false}
            onChange={() =>
              handleStyleChangeComplete(
                'noteGlowEnabled',
                !(keyPosition.noteGlowEnabled ?? false),
              )
            }
          />
        </div>

        {/* 글로우 색상/크기/투명도 */}
        <PropertyRow label={t('keySetting.noteGlowColor') || '글로우 색상'}>
          <ColorSwatchButton
            ref={glowColorButtonRef}
            type="button"
            onClick={() => handlePickerToggle('glow')}
            open={pickerFor === 'glow'}
            className="w-[23px] h-[23px] rounded-md cursor-pointer transition-shadow flex-shrink-0"
            surfaceClassName="rounded-md"
            color={
              glowColorMode === COLOR_MODES.solid ? glowColorTop : undefined
            }
            gradient={
              glowColorMode === COLOR_MODES.gradient
                ? { top: glowColorTop, bottom: glowGradientBottom }
                : undefined
            }
            opacity={
              glowColorMode === COLOR_MODES.gradient
                ? {
                    top: localGlowOpacityTop / 100,
                    bottom: localGlowOpacityBottom / 100,
                  }
                : localGlowOpacity / 100
            }
          />
        </PropertyRow>

        <PropertyRow label={t('keySetting.noteGlowSize') || '글로우 크기'}>
          <NumberInput
            value={keyPosition.noteGlowSize ?? 20}
            onChange={(value) =>
              handleStyleChangeComplete('noteGlowSize', value)
            }
            onPreview={(value) => handleStylePreview('noteGlowSize', value)}
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
      {pickerFor && (
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
            pickerFor === 'note'
              ? notePickerColor
              : pickerFor === 'glow'
              ? glowPickerColor
              : hexWithAlphaPercent(borderColor, localBorderOpacity)
          }
          onColorChange={(c: NoteColor) => {
            if (pickerFor === 'border') {
              const raw = typeof c === 'string' ? c : undefined;
              const hex = toRgbHexColor(raw);
              const opacity = parseAlphaPercent(raw, localBorderOpacity);
              setBorderColor(hex);
              setLocalBorderOpacity(opacity);
              return;
            }
            handleColorChange(pickerFor, c);
          }}
          onColorChangeComplete={(c: NoteColor) => {
            if (pickerFor === 'border') {
              const raw = typeof c === 'string' ? c : undefined;
              const hex = toRgbHexColor(raw);
              const opacity = parseAlphaPercent(raw, localBorderOpacity);
              setBorderColor(hex);
              setLocalBorderOpacity(opacity);
              onKeyPreview?.(keyIndex, {
                noteBorderColor: hex,
                noteBorderOpacity: opacity,
              });
              onKeyUpdate({
                index: keyIndex,
                noteBorderColor: hex,
                noteBorderOpacity: opacity,
              });
              return;
            }
            handleColorChangeComplete(pickerFor, c);
          }}
          onClose={() => setPickerFor(null)}
          interactiveRefs={interactiveRefs}
          solidOnly={pickerFor === 'border'}
          {...(pickerFor !== 'border' && {
            opacityPercent:
              pickerFor === 'note'
                ? noteColorMode === COLOR_MODES.gradient
                  ? { top: localNoteOpacityTop, bottom: localNoteOpacityBottom }
                  : localNoteOpacity
                : glowColorMode === COLOR_MODES.gradient
                ? { top: localGlowOpacityTop, bottom: localGlowOpacityBottom }
                : localGlowOpacity,
            onOpacityPercentChange: (
              value: number,
              target: 'solid' | 'top' | 'bottom',
            ) => {
              if (pickerFor === 'note') {
                if (target === 'solid') {
                  setLocalNoteOpacity(value);
                  setLocalNoteOpacityTop(value);
                  setLocalNoteOpacityBottom(value);
                  return;
                }
                if (target === 'top') {
                  setLocalNoteOpacityTop(value);
                  setLocalNoteOpacity(
                    Math.round((value + localNoteOpacityBottom) / 2),
                  );
                  return;
                }
                setLocalNoteOpacityBottom(value);
                setLocalNoteOpacity(
                  Math.round((localNoteOpacityTop + value) / 2),
                );
                return;
              }

              if (target === 'solid') {
                setLocalGlowOpacity(value);
                setLocalGlowOpacityTop(value);
                setLocalGlowOpacityBottom(value);
                return;
              }
              if (target === 'top') {
                setLocalGlowOpacityTop(value);
                setLocalGlowOpacity(
                  Math.round((value + localGlowOpacityBottom) / 2),
                );
                return;
              }
              setLocalGlowOpacityBottom(value);
              setLocalGlowOpacity(
                Math.round((localGlowOpacityTop + value) / 2),
              );
            },
            onOpacityPercentChangeComplete: (
              value: number,
              target: 'solid' | 'top' | 'bottom',
            ) => {
              if (pickerFor === 'note') {
                if (target === 'solid') {
                  setLocalNoteOpacity(value);
                  setLocalNoteOpacityTop(value);
                  setLocalNoteOpacityBottom(value);
                  const payload = {
                    noteOpacity: value,
                    noteOpacityTop: value,
                    noteOpacityBottom: value,
                  };
                  onKeyPreview?.(keyIndex, payload);
                  onKeyUpdate({ index: keyIndex, ...payload });
                  return;
                }

                const nextTop = target === 'top' ? value : localNoteOpacityTop;
                const nextBottom =
                  target === 'bottom' ? value : localNoteOpacityBottom;
                const nextBase = Math.round((nextTop + nextBottom) / 2);
                setLocalNoteOpacity(nextBase);
                if (target === 'top') setLocalNoteOpacityTop(value);
                else setLocalNoteOpacityBottom(value);

                const payload = {
                  noteOpacity: nextBase,
                  noteOpacityTop: nextTop,
                  noteOpacityBottom: nextBottom,
                };
                onKeyPreview?.(keyIndex, payload);
                onKeyUpdate({ index: keyIndex, ...payload });
                return;
              }

              if (target === 'solid') {
                setLocalGlowOpacity(value);
                setLocalGlowOpacityTop(value);
                setLocalGlowOpacityBottom(value);
                const payload = {
                  noteGlowOpacity: value,
                  noteGlowOpacityTop: value,
                  noteGlowOpacityBottom: value,
                };
                onKeyPreview?.(keyIndex, payload);
                onKeyUpdate({ index: keyIndex, ...payload });
                return;
              }

              const nextTop = target === 'top' ? value : localGlowOpacityTop;
              const nextBottom =
                target === 'bottom' ? value : localGlowOpacityBottom;
              const nextBase = Math.round((nextTop + nextBottom) / 2);
              setLocalGlowOpacity(nextBase);
              if (target === 'top') setLocalGlowOpacityTop(value);
              else setLocalGlowOpacityBottom(value);

              const payload = {
                noteGlowOpacity: nextBase,
                noteGlowOpacityTop: nextTop,
                noteGlowOpacityBottom: nextBottom,
              };
              onKeyPreview?.(keyIndex, payload);
              onKeyUpdate({ index: keyIndex, ...payload });
            },
            opacityPercentLabel:
              pickerFor === 'note'
                ? t('keySetting.noteOpacity') || '노트 투명도'
                : t('keySetting.noteGlowOpacity') || '글로우 투명도',
          })}
        />
      )}
    </>
  );
};

export default NoteTabContent;
