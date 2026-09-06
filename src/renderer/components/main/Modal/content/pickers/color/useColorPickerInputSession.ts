import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { flushSync } from 'react-dom';
import {
  MODES,
  buildGradient,
  isGradientColor,
  normalizeColorInput,
  parseHexColor,
  toColorObject,
  type ColorObject,
  type GradientColor,
} from '@utils/color/colorUtils';
import type { GradientSide } from './ColorPickerInputs';

export type ColorPickerValue = string | GradientColor;
export type ColorPickerOpacityTarget = 'solid' | 'top' | 'bottom';

interface UseColorPickerInputSessionOptions {
  referenceRef: React.RefObject<HTMLElement>;
  color: ColorPickerValue;
  solidOnly: boolean;
  hexMixed: boolean;
  mode: string;
  setMode: React.Dispatch<React.SetStateAction<string>>;
  selectedColor: ColorObject;
  setSelectedColor: React.Dispatch<React.SetStateAction<ColorObject>>;
  alpha: number;
  setAlpha: React.Dispatch<React.SetStateAction<number>>;
  gradientTop: string;
  setGradientTop: React.Dispatch<React.SetStateAction<string>>;
  gradientBottom: string;
  setGradientBottom: React.Dispatch<React.SetStateAction<string>>;
  gradientSelected: GradientSide;
  setGradientSelected: React.Dispatch<React.SetStateAction<GradientSide>>;
  suppressGradientResetRef: React.MutableRefObject<boolean>;
  isDraggingRef: React.MutableRefObject<boolean>;
  hasSeededGradientFromSolidRef: React.MutableRefObject<boolean>;
  userSwitchedModeRef: React.MutableRefObject<boolean>;
  prevColorRef: React.MutableRefObject<ColorPickerValue>;
  historyTick: number;
  onColorChange?: (color: ColorPickerValue) => void;
  onColorChangeComplete?: (color: ColorPickerValue) => void;
  onInputCancel?: (
    target: ColorPickerOpacityTarget,
    restoredColor: ColorPickerValue,
  ) => void;
  onOpacityPercentCancel?: (target: ColorPickerOpacityTarget) => void;
}

export const useColorPickerInputSession = ({
  referenceRef,
  color,
  solidOnly,
  hexMixed,
  mode,
  setMode,
  selectedColor,
  setSelectedColor,
  alpha,
  setAlpha,
  gradientTop,
  setGradientTop,
  gradientBottom,
  setGradientBottom,
  gradientSelected,
  setGradientSelected,
  suppressGradientResetRef,
  isDraggingRef,
  hasSeededGradientFromSolidRef,
  userSwitchedModeRef,
  prevColorRef,
  historyTick,
  onColorChange,
  onColorChangeComplete,
  onInputCancel,
  onOpacityPercentCancel,
}: UseColorPickerInputSessionOptions) => {
  const historyTickRef = useRef(historyTick);
  useEffect(() => {
    if (historyTickRef.current !== historyTick) {
      historyTickRef.current = historyTick;
      isDraggingRef.current = false;
    }
    // 드래그 중 외부 color prop 동기화 제외
    if (isDraggingRef.current) {
      return;
    }

    const wasGradient = isGradientColor(prevColorRef.current);
    const isGradientNow = isGradientColor(color);

    if (userSwitchedModeRef.current) {
      userSwitchedModeRef.current = false;
    } else {
      setMode(isGradientNow ? MODES.gradient : MODES.solid);
    }

    if (isGradientNow) {
      const topHex = color.top.replace('#', '').toUpperCase();
      const bottomHex = color.bottom.replace('#', '').toUpperCase();
      setGradientTop(topHex);
      setGradientBottom(bottomHex);
      hasSeededGradientFromSolidRef.current = true;

      const targetHex = gradientSelected === 'bottom' ? bottomHex : topHex;
      const parsedTarget = parseHexColor(targetHex);
      if (parsedTarget) {
        // 동일 색상의 HSV 보존
        setSelectedColor((prev) =>
          prev.hex === parsedTarget.hex ? prev : parsedTarget,
        );
      }

      if (!wasGradient) {
        setGradientSelected('top');
      } else if (gradientSelected !== 'top' && gradientSelected !== 'bottom') {
        setGradientSelected('top');
      }
    } else if (typeof color === 'string') {
      const normalized = normalizeColorInput(color);
      const parsed = toColorObject(normalized);
      if (parsed) {
        // 동일 색상의 HSV와 외부 alpha 병합
        setSelectedColor((prev) => {
          if (prev.hex !== parsed.hex) return parsed;
          const nextAlpha = parsed.rgb.a ?? 1;
          if (prev.rgb.a === nextAlpha) return prev;
          return {
            ...prev,
            rgb: { ...prev.rgb, a: nextAlpha },
            hsv: { ...prev.hsv, a: nextAlpha },
          };
        });
        const newAlpha = extractAlphaFromColor(color);
        setAlpha(newAlpha);

        if (
          !suppressGradientResetRef.current &&
          !hasSeededGradientFromSolidRef.current
        ) {
          setGradientTop(parsed.hex.replace('#', ''));
          setGradientBottom('FFFFFF');
        }
      }
      setGradientSelected('top');
      suppressGradientResetRef.current = false;
    }

    prevColorRef.current = color;
    // 부모 setter/ref는 안정 참조이며 canonical 신호만 재동기화 경계를 구성
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [color, gradientSelected, setSelectedColor, historyTick]);

  const [inputValue, setInputValue] = useState<string>(() =>
    selectedColor.hex
      .replace('#', '')
      .toUpperCase()
      .slice(0, solidOnly ? 6 : 8),
  );

  const hexDirtyRef = useRef(false);
  const solidInputEditRef = useRef<{
    inputValue: string;
    color: ColorPickerValue;
    selectedColor: ColorObject;
    alpha: number;
    previewed: boolean;
  } | null>(null);
  const gradientInputEditRef = useRef<{
    side: GradientSide;
    top: string;
    bottom: string;
    color: GradientColor;
    selectedColor: ColorObject;
    dirty: boolean;
    previewed: boolean;
  } | null>(null);

  useEffect(() => {
    if (solidInputEditRef.current) return;
    setInputValue(
      selectedColor.hex
        .replace('#', '')
        .toUpperCase()
        .slice(0, solidOnly ? 6 : 8),
    );
  }, [selectedColor.hex, solidOnly]);

  const buildRgbaFromHexAndAlpha = (hex: string, nextAlpha: number): string => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${nextAlpha})`;
  };

  const setAlphaWithSync = (nextAlpha: number, isComplete: boolean = false) => {
    const clamped = Math.min(Math.max(Number(nextAlpha) || 0, 0), 1);
    setAlpha(clamped);
    setSelectedColor((prev: ColorObject) => {
      if (!prev) return prev;
      return {
        ...prev,
        rgb: { ...prev.rgb, a: clamped },
        hsv: { ...prev.hsv, a: clamped },
      };
    });

    if (!solidOnly) return;
    const rgbaValue = buildRgbaFromHexAndAlpha(selectedColor.hex, clamped);
    onColorChange?.(rgbaValue);
    if (isComplete) {
      onColorChangeComplete?.(rgbaValue);
    }
  };

  const applyColor = (
    next: string | Partial<ColorObject>,
    isComplete: boolean = false,
  ) => {
    const parsed = toColorObject(next);
    if (!parsed) return;
    setSelectedColor(parsed);
    if (!solidOnly && mode === MODES.gradient) {
      const newHex = parsed.hex.replace('#', '').toUpperCase();

      if (gradientSelected === 'top') {
        setGradientTop(newHex);
        const gradient = buildGradient(parsed.hex, `#${gradientBottom}`);
        onColorChange?.(gradient);
        if (isComplete) onColorChangeComplete?.(gradient);
      } else {
        setGradientBottom(newHex);
        const gradient = buildGradient(`#${gradientTop}`, parsed.hex);
        onColorChange?.(gradient);
        if (isComplete) onColorChangeComplete?.(gradient);
      }
      return;
    }
    if (solidOnly) {
      const rgbaValue = `rgba(${parseInt(
        parsed.hex.slice(1, 3),
        16,
      )}, ${parseInt(parsed.hex.slice(3, 5), 16)}, ${parseInt(
        parsed.hex.slice(5, 7),
        16,
      )}, ${alpha})`;
      onColorChange?.(rgbaValue);
      if (isComplete) onColorChangeComplete?.(rgbaValue);
    } else {
      onColorChange?.(parsed.hex);
      if (isComplete) onColorChangeComplete?.(parsed.hex);
    }
  };

  const handleChange = (nextColor: ColorObject) => {
    isDraggingRef.current = true;
    applyColor(nextColor, false);
  };

  const handleChangeComplete = (nextColor: ColorObject) => {
    applyColor(nextColor, true);
    isDraggingRef.current = false;
  };

  const validHexDraft = (value: string, allowAlpha: boolean): boolean =>
    value.length === 6 || (allowAlpha && value.length === 8);

  const solidOutput = (parsed: ColorObject, draft: string): string =>
    solidOnly
      ? buildRgbaFromHexAndAlpha(parsed.hex, alpha)
      : draft.length === 8
      ? `#${draft}`
      : parsed.hex;

  const startSolidInputEdit = () => {
    const baseColor = solidOnly
      ? buildRgbaFromHexAndAlpha(selectedColor.hex, alpha)
      : inputValue.length === 8
      ? `#${inputValue}`
      : selectedColor.hex;
    solidInputEditRef.current = {
      inputValue,
      color: baseColor,
      selectedColor,
      alpha,
      previewed: false,
    };
    hexDirtyRef.current = false;
    if (hexMixed) setInputValue('');
  };

  const handleInputChange = (raw: string) => {
    const sanitized = raw
      .replace(/[^0-9a-fA-F]/g, '')
      .slice(0, solidOnly ? 6 : 8)
      .toUpperCase();
    if (!solidInputEditRef.current) startSolidInputEdit();
    hexDirtyRef.current = true;
    setInputValue(sanitized);
    if (!validHexDraft(sanitized, !solidOnly)) return;
    const parsed = parseHexColor(sanitized);
    if (!parsed) return;
    const nextSelected = solidOnly
      ? {
          ...parsed,
          rgb: { ...parsed.rgb, a: alpha },
          hsv: { ...parsed.hsv, a: alpha },
        }
      : parsed;
    setSelectedColor(nextSelected);
    if (solidInputEditRef.current) {
      solidInputEditRef.current.previewed = true;
    }
    onColorChange?.(solidOutput(parsed, sanitized));
  };

  const restoreSolidInput = () => {
    const edit = solidInputEditRef.current;
    if (!edit) return;
    setInputValue(edit.inputValue);
    setSelectedColor(edit.selectedColor);
    setAlpha(edit.alpha);
    hexDirtyRef.current = false;
    solidInputEditRef.current = null;
    if (!edit.previewed) return;
    if (onInputCancel) {
      onInputCancel('solid', edit.color);
    } else if (!hexMixed) {
      onColorChange?.(edit.color);
    }
  };

  const commitSolidInput = () => {
    if (!hexDirtyRef.current) {
      const edit = solidInputEditRef.current;
      if (edit) setInputValue(edit.inputValue);
      solidInputEditRef.current = null;
      return;
    }
    if (!validHexDraft(inputValue, !solidOnly)) {
      restoreSolidInput();
      return;
    }
    const parsed = parseHexColor(inputValue);
    if (!parsed) {
      restoreSolidInput();
      return;
    }
    hexDirtyRef.current = false;
    solidInputEditRef.current = null;
    onColorChangeComplete?.(solidOutput(parsed, inputValue));
  };

  const cancelSolidInput = (): boolean => {
    if (!hexDirtyRef.current) return false;
    restoreSolidInput();
    return true;
  };

  const previewAlphaPercent = (percent: number) => {
    setAlphaWithSync(percent / 100, false);
  };

  const commitAlphaPercent = (percent: number) => {
    setAlphaWithSync(percent / 100, true);
  };

  const alphaEditBaseRef = useRef(alpha);

  const startAlphaEdit = () => {
    alphaEditBaseRef.current = alpha;
  };

  const cancelAlphaPercent = () => {
    const base = alphaEditBaseRef.current;
    const restoredColor = buildRgbaFromHexAndAlpha(selectedColor.hex, base);
    if (onInputCancel) {
      setAlpha(base);
      setSelectedColor((prev) => ({
        ...prev,
        rgb: { ...prev.rgb, a: base },
        hsv: { ...prev.hsv, a: base },
      }));
      onInputCancel('solid', restoredColor);
      return;
    }
    if (onOpacityPercentCancel) {
      setAlpha(base);
      setSelectedColor((prev) => ({
        ...prev,
        rgb: { ...prev.rgb, a: base },
        hsv: { ...prev.hsv, a: base },
      }));
      onOpacityPercentCancel('solid');
      return;
    }
    setAlphaWithSync(base, false);
  };

  const commitGradient = () => {
    const parsedTop = parseHexColor(gradientTop);
    const parsedBottom = parseHexColor(gradientBottom);
    if (!parsedTop || !parsedBottom) {
      return;
    }
    setSelectedColor(parsedTop);
    const gradient = buildGradient(`#${gradientTop}`, `#${gradientBottom}`);
    onColorChange?.(gradient);
    onColorChangeComplete?.(gradient);
  };

  const startGradientInputEdit = (side: GradientSide) => {
    const selectedValue = side === 'top' ? gradientTop : gradientBottom;
    const parsed = parseHexColor(selectedValue) ?? selectedColor;
    setGradientSelected(side);
    setSelectedColor(parsed);
    gradientInputEditRef.current = {
      side,
      top: gradientTop,
      bottom: gradientBottom,
      color: buildGradient(`#${gradientTop}`, `#${gradientBottom}`),
      selectedColor: parsed,
      dirty: false,
      previewed: false,
    };
  };

  const handleGradientInputChange = (side: GradientSide, raw: string) => {
    const sanitized = raw
      .replace(/[^0-9a-fA-F]/g, '')
      .slice(0, 8)
      .toUpperCase();
    if (gradientInputEditRef.current?.side !== side) {
      startGradientInputEdit(side);
    }
    const edit = gradientInputEditRef.current;
    if (edit) edit.dirty = true;
    if (side === 'top') setGradientTop(sanitized);
    else setGradientBottom(sanitized);
    if (!validHexDraft(sanitized, true)) return;
    const parsed = parseHexColor(sanitized);
    const other = parseHexColor(side === 'top' ? gradientBottom : gradientTop);
    if (!parsed || !other) return;
    setSelectedColor(parsed);
    if (edit) edit.previewed = true;
    onColorChange?.(
      side === 'top'
        ? buildGradient(`#${sanitized}`, `#${gradientBottom}`)
        : buildGradient(`#${gradientTop}`, `#${sanitized}`),
    );
  };

  const restoreGradientInput = () => {
    const edit = gradientInputEditRef.current;
    if (!edit) return;
    setGradientTop(edit.top);
    setGradientBottom(edit.bottom);
    setSelectedColor(edit.selectedColor);
    setGradientSelected(edit.side);
    gradientInputEditRef.current = null;
    if (!edit.previewed) return;
    if (onInputCancel) onInputCancel(edit.side, edit.color);
    else onColorChange?.(edit.color);
  };

  const commitGradientInput = (side: GradientSide) => {
    const edit = gradientInputEditRef.current;
    if (!edit?.dirty) {
      gradientInputEditRef.current = null;
      return;
    }
    if (
      !validHexDraft(gradientTop, true) ||
      !validHexDraft(gradientBottom, true)
    ) {
      restoreGradientInput();
      return;
    }
    const parsedTop = parseHexColor(gradientTop);
    const parsedBottom = parseHexColor(gradientBottom);
    if (!parsedTop || !parsedBottom) {
      restoreGradientInput();
      return;
    }
    setGradientSelected(side);
    setSelectedColor(side === 'top' ? parsedTop : parsedBottom);
    gradientInputEditRef.current = null;
    onColorChangeComplete?.(
      buildGradient(`#${gradientTop}`, `#${gradientBottom}`),
    );
  };

  const cancelGradientInput = (side: GradientSide): boolean => {
    const edit = gradientInputEditRef.current;
    if (!edit || edit.side !== side || !edit.dirty) return false;
    restoreGradientInput();
    return true;
  };

  const selectGradient = (side: GradientSide) => {
    setGradientSelected(side);
    const hex = `#${side === 'top' ? gradientTop : gradientBottom}`;
    const parsed = parseHexColor(hex);
    if (parsed) setSelectedColor(parsed);
  };

  const handleModeSwitch = (nextMode: string) => {
    if (nextMode === mode) return;
    userSwitchedModeRef.current = true;
    setMode(nextMode);
    if (nextMode === MODES.solid) {
      suppressGradientResetRef.current = true;
      const parsed = parseHexColor(gradientTop || inputValue);
      if (parsed) {
        setSelectedColor(parsed);
        onColorChange?.(parsed.hex);
        onColorChangeComplete?.(parsed.hex);
      }
    } else {
      hasSeededGradientFromSolidRef.current = true;
      setGradientSelected('top');
      commitGradient();
    }
  };

  const flushActiveInput = () => {
    const ownerDocument = referenceRef.current?.ownerDocument ?? document;
    const active = ownerDocument.activeElement;
    if (
      active?.matches('input, textarea') &&
      active.closest('[role="dialog"]')
    ) {
      flushSync(() => (active as HTMLElement).blur());
    }
  };

  return {
    inputValue,
    setAlphaWithSync,
    handleChange,
    handleChangeComplete,
    startSolidInputEdit,
    handleInputChange,
    commitSolidInput,
    cancelSolidInput,
    startAlphaEdit,
    previewAlphaPercent,
    commitAlphaPercent,
    cancelAlphaPercent,
    startGradientInputEdit,
    handleGradientInputChange,
    commitGradientInput,
    cancelGradientInput,
    selectGradient,
    handleModeSwitch,
    flushActiveInput,
  };
};

const extractAlphaFromColor = (colorValue: ColorPickerValue): number => {
  if (typeof colorValue === 'string') {
    if (colorValue.startsWith('rgba(')) {
      const match = colorValue.match(
        /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/,
      );
      if (match) {
        return parseFloat(match[4]);
      }
    }
    const normalized = normalizeColorInput(colorValue);
    const parsed = parseHexColor(normalized);
    if (parsed && parsed.rgb.a !== undefined) {
      return parsed.rgb.a;
    }
  }
  return 1;
};
