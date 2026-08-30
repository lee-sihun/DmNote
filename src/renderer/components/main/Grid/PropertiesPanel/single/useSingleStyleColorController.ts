import { useEffect, useRef, useState } from 'react';
import type { KeyPosition } from '@src/types/key/keys';
import type { EditorPaintPropertyPatchV1 } from '@src/types/editor';
import type { GradientCanvasAnchor } from '@stores/grid/useGradientEditStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useGradientColorState } from '@hooks/pickers/useGradientColorState';
import {
  paintDescriptor,
  type ColorModeValue,
  type GradientSpec,
} from '@src/types/color';
import {
  DEFAULT_ELEMENT_ACTIVE_BG,
  DEFAULT_ELEMENT_ACTIVE_BORDER,
  DEFAULT_ELEMENT_ACTIVE_FONT,
  DEFAULT_ELEMENT_BG,
  DEFAULT_ELEMENT_BORDER,
  DEFAULT_ELEMENT_FONT,
} from '@utils/core/elementDefaults';
import {
  elementImageReplacesSurface,
  resolveElementBorder,
} from '@utils/core/elementBorder';
import { editGestureController } from '@src/renderer/editor/runtime/editGestureController';

export type SingleStyleColorTarget =
  | 'backgroundColor'
  | 'borderColor'
  | 'fontColor';

type PickerTarget = SingleStyleColorTarget | null;
type ColorState = 'idle' | 'active';
type ActiveStyleColorProperty =
  | 'activeBackgroundColor'
  | 'activeBorderColor'
  | 'activeFontColor';
type StyleColorProperty = SingleStyleColorTarget | ActiveStyleColorProperty;

interface UseSingleStyleColorControllerOptions {
  keyPosition: KeyPosition;
  shadowActiveState: boolean;
  canvasAnchor?: GradientCanvasAnchor;
  onPaintPreview?: (patch: EditorPaintPropertyPatchV1) => void;
  onPaintCommit?: (patch: EditorPaintPropertyPatchV1) => void;
}

const initialLocalColors = (
  keyPosition: KeyPosition,
): Record<StyleColorProperty, string> => ({
  backgroundColor: keyPosition.backgroundColor || DEFAULT_ELEMENT_BG,
  activeBackgroundColor:
    keyPosition.activeBackgroundColor ||
    keyPosition.backgroundColor ||
    DEFAULT_ELEMENT_ACTIVE_BG,
  borderColor: keyPosition.borderColor || DEFAULT_ELEMENT_BORDER,
  activeBorderColor:
    keyPosition.activeBorderColor ||
    keyPosition.borderColor ||
    DEFAULT_ELEMENT_ACTIVE_BORDER,
  fontColor: keyPosition.fontColor || DEFAULT_ELEMENT_FONT,
  activeFontColor:
    keyPosition.activeFontColor ||
    keyPosition.fontColor ||
    DEFAULT_ELEMENT_ACTIVE_FONT,
});

export const useSingleStyleColorController = ({
  keyPosition,
  shadowActiveState,
  canvasAnchor,
  onPaintPreview,
  onPaintCommit,
}: UseSingleStyleColorControllerOptions) => {
  const [pickerFor, setPickerFor] = useState<PickerTarget>(null);
  const [colorState, setColorState] = useState<ColorState>('idle');
  const effectiveColorState = shadowActiveState ? colorState : 'idle';
  const selectedKeyType = useKeyStore((state) => state.selectedKeyType);

  useEffect(() => {
    if (!shadowActiveState) {
      setColorState('idle');
      setPickerFor(null);
    }
  }, [shadowActiveState]);

  const backgroundColorButtonRef = useRef<HTMLButtonElement>(null);
  const borderColorButtonRef = useRef<HTMLButtonElement>(null);
  const fontColorButtonRef = useRef<HTMLButtonElement>(null);
  const [localColors, setLocalColors] = useState<
    Record<StyleColorProperty, string>
  >(() => initialLocalColors(keyPosition));

  useEffect(() => {
    if (!pickerFor) {
      setLocalColors(initialLocalColors(keyPosition));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 선택 객체 identity가 아닌 색상 필드 변경만 동기화
  }, [
    pickerFor,
    keyPosition.backgroundColor,
    keyPosition.activeBackgroundColor,
    keyPosition.borderColor,
    keyPosition.activeBorderColor,
    keyPosition.fontColor,
    keyPosition.activeFontColor,
  ]);

  const colorPickerInteractiveRefs = [
    backgroundColorButtonRef,
    borderColorButtonRef,
    fontColorButtonRef,
  ];

  const handlePickerToggle = (target: PickerTarget) => {
    setPickerFor((prev) => (prev === target ? null : target));
    // 새로 열 때 대기 탭부터 시작 — 이전 입력 상태가 첫 렌더에 노출되지 않게 동기 리셋
    if (pickerFor !== target) setColorState('idle');
  };

  const resolveColorProperty = (
    target: SingleStyleColorTarget,
  ): StyleColorProperty => {
    if (effectiveColorState !== 'active') return target;
    switch (target) {
      case 'backgroundColor':
        return 'activeBackgroundColor';
      case 'borderColor':
        return 'activeBorderColor';
      case 'fontColor':
        return 'activeFontColor';
    }
  };

  const activeColorPropertyFor = (
    target: SingleStyleColorTarget,
  ): ActiveStyleColorProperty => {
    switch (target) {
      case 'backgroundColor':
        return 'activeBackgroundColor';
      case 'borderColor':
        return 'activeBorderColor';
      case 'fontColor':
        return 'activeFontColor';
    }
  };

  const storedGradientOf = (prop: StyleColorProperty): GradientSpec | null => {
    switch (prop) {
      case 'backgroundColor':
        return keyPosition.backgroundGradient ?? null;
      case 'activeBackgroundColor':
        return keyPosition.activeBackgroundGradient ?? null;
      case 'borderColor':
        return keyPosition.borderGradient ?? null;
      case 'activeBorderColor':
        return keyPosition.activeBorderGradient ?? null;
      case 'fontColor':
        return keyPosition.fontGradient ?? null;
      case 'activeFontColor':
        return keyPosition.activeFontGradient ?? null;
    }
  };

  const colorValueFor = (target: SingleStyleColorTarget): string =>
    localColors[resolveColorProperty(target)];

  const handleColorChange = (target: SingleStyleColorTarget, color: string) => {
    const prop = resolveColorProperty(target);
    setLocalColors((prev) => ({ ...prev, [prop]: color }));
  };

  const gradientTarget = pickerFor;
  const gradientSpecFor = (
    target: SingleStyleColorTarget,
  ): GradientSpec | null => {
    if (target === 'borderColor') {
      const active = effectiveColorState === 'active';
      return resolveElementBorder(keyPosition, active, {
        suppressDefault: elementImageReplacesSurface(keyPosition, active),
      }).gradient;
    }
    const idleGradient = storedGradientOf(target);
    if (effectiveColorState !== 'active') return idleGradient;
    const activeProp = activeColorPropertyFor(target);
    const activeGradient = storedGradientOf(activeProp);
    const activeHasValue =
      (typeof keyPosition[activeProp] === 'string' &&
        keyPosition[activeProp].trim().length > 0) ||
      activeGradient != null;
    return activeHasValue ? activeGradient : idleGradient;
  };

  const paintFieldFor = (target: SingleStyleColorTarget) =>
    target === 'backgroundColor'
      ? effectiveColorState === 'active'
        ? 'activeBackgroundPaint'
        : 'backgroundPaint'
      : target === 'borderColor'
      ? effectiveColorState === 'active'
        ? 'activeBorderPaint'
        : 'borderPaint'
      : effectiveColorState === 'active'
      ? 'activeFontPaint'
      : 'fontPaint';

  const handleGradientPreview = (value: ColorModeValue) => {
    if (!gradientTarget) return;
    const prop = resolveColorProperty(gradientTarget);
    const descriptor = paintDescriptor(value);
    setLocalColors((prev) => ({ ...prev, [prop]: descriptor.color }));
    onPaintPreview?.({
      property: paintFieldFor(gradientTarget),
      value: descriptor,
    });
  };

  const handleGradientCommit = (value: ColorModeValue) => {
    if (!gradientTarget) return;
    const prop = resolveColorProperty(gradientTarget);
    const descriptor = paintDescriptor(value);
    setLocalColors((prev) => ({ ...prev, [prop]: descriptor.color }));
    onPaintCommit?.({
      property: paintFieldFor(gradientTarget),
      value: descriptor,
    });
  };

  const gradientState = useGradientColorState({
    pair: gradientTarget
      ? {
          color: colorValueFor(gradientTarget),
          gradient: gradientSpecFor(gradientTarget),
        }
      : {},
    fallbackColor: '#ffffff',
    contextKey: `${canvasAnchor?.kind ?? 'key'}:${selectedKeyType}:${
      canvasAnchor?.kind === 'batch' ? 'batch' : canvasAnchor?.id
    }:${pickerFor ?? 'none'}:${effectiveColorState}`,
    canvasAnchor: gradientTarget ? canvasAnchor : undefined,
    canvasSurface:
      gradientTarget === 'borderColor'
        ? 'border'
        : gradientTarget === 'fontColor'
        ? 'font'
        : 'background',
    canvasState: effectiveColorState,
    onPreview: handleGradientPreview,
    onCancel: () => editGestureController.cancel(),
    onCommit: handleGradientCommit,
  });

  const getDisplayColor = (color: string): string => {
    if (!color) return '#ffffff';
    if (color.startsWith('rgba') || color.startsWith('rgb')) return color;
    if (color.startsWith('#')) return color;
    return '#ffffff';
  };

  return {
    pickerFor,
    setPickerFor,
    effectiveColorState,
    setColorState,
    backgroundColorButtonRef,
    borderColorButtonRef,
    fontColorButtonRef,
    colorPickerInteractiveRefs,
    handlePickerToggle,
    resolveColorProperty,
    colorValueFor,
    handleColorChange,
    handleColorChangeComplete: handleColorChange,
    gradientTarget,
    gradientSpecFor,
    gradientState,
    setLocalColors,
    getDisplayColor,
  };
};
