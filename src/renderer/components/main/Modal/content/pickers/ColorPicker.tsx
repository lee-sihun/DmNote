/* eslint-disable react-hooks/set-state-in-effect */
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@contexts/useTranslation';
import {
  SaturationArea,
  HueSlider,
  AlphaSlider,
} from './colorPickerPrimitives';
import PickerSurface from '@components/main/Grid/PropertiesPanel/PickerSurface';
import TabSwitch from '@components/main/common/TabSwitch';
import {
  MODES,
  isGradientColor,
  normalizeColorInput,
  buildGradient,
  parseHexColor,
  hsvToColorObject,
  toColorObject,
  type GradientColor,
  type ColorObject,
} from '@utils/color/colorUtils';
import {
  loadPalette,
  addToPalette,
  isGradientSpecColor,
  gradientSpecPaletteEntry,
  type GradientSpecColor,
} from '@utils/color/colorPaletteStorage';
import {
  gradientToCss,
  toCanonicalGradient,
  type GradientSpec,
} from '@src/types/color';
import { ColorSwatchButton, ColorSwatchSurface } from './ColorSwatch';
import { useCommittedApplyStore } from '@stores/data/useCommittedApplyStore';

type ColorValue = string | GradientColor;
type PaletteValue = ColorValue | GradientSpecColor;

// normalizeColorInput 기본색과 동일
const DEFAULT_PICKER_COLOR: ColorObject =
  parseHexColor('#561ecb') ?? hsvToColorObject({ h: 0, s: 0, v: 100, a: 1 });
type GradientSide = 'top' | 'bottom';
type OpacityTarget = 'solid' | 'top' | 'bottom';

interface ResolvedOpacity {
  solid: number;
  top: number;
  bottom: number;
}

interface ColorPickerWrapperProps {
  open: boolean;
  referenceRef: React.RefObject<HTMLElement>;
  panelElement?: HTMLElement | null;
  color: ColorValue;
  onColorChange?: (color: ColorValue) => void;
  onColorChangeComplete?: (color: ColorValue) => void;
  onClose?: () => void;
  solidOnly?: boolean;
  /** 색 알파 UI 숨김 - 외부 투명도 조절기가 알파를 대신하는 단색 형식용 */
  hideColorAlpha?: boolean;
  /** 상태 스위치 아래에 삽입되는 커스텀 헤더 (그라데이션 스톱 에디터) */
  headerSlot?: React.ReactNode;
  /** 팔레트 아래 삽입되는 커스텀 푸터 (형식 셀렉트 바) */
  footerSlot?: React.ReactNode;
  /** 그라데이션 형식 편집 중인 spec — 지정 시 닫힐 때 팔레트에 저장 (undefined = 미지원) */
  gradientSpec?: GradientSpec | null;
  /** 그라데이션 팔레트 항목 클릭 시 spec 전체 적용 */
  onGradientSpecSelect?: (spec: GradientSpec) => void;
  stateMode?: string;
  onStateModeChange?:
    | React.Dispatch<React.SetStateAction<string>>
    | ((mode: string) => void);
  opacityPercent?: number | { top: number; bottom: number };
  onOpacityPercentChange?: (value: number, target: OpacityTarget) => void;
  onOpacityPercentChangeComplete?: (
    value: number,
    target: OpacityTarget,
  ) => void;
  opacityPercentLabel?: string;
  opacityPercentMixed?: boolean;
  interactiveRefs?: React.RefObject<HTMLElement>[];
  position?: { x: number; y: number } | string;
  offsetY?: number;
  placement?: string;
  closeOnScroll?: boolean;
}

const extractAlphaFromColor = (colorValue: ColorValue): number => {
  if (typeof colorValue === 'string') {
    if (colorValue.startsWith('rgba(')) {
      const match = colorValue.match(
        /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/,
      );
      if (match) {
        return parseFloat(match[4]);
      }
    }
    // Hex 처리
    const normalized = normalizeColorInput(colorValue);
    const parsed = parseHexColor(normalized);
    if (parsed && parsed.rgb.a !== undefined) {
      return parsed.rgb.a;
    }
  }
  return 1;
};

const ColorPickerWrapper = ({
  open,
  referenceRef,
  panelElement = null,
  color,
  onColorChange,
  onColorChangeComplete,
  onClose,
  solidOnly = false,
  hideColorAlpha = false,
  headerSlot = undefined,
  footerSlot = undefined,
  gradientSpec = undefined,
  onGradientSpecSelect = undefined,
  stateMode = undefined,
  onStateModeChange = undefined,
  opacityPercent = undefined,
  onOpacityPercentChange = undefined,
  onOpacityPercentChangeComplete = undefined,
  opacityPercentLabel = undefined,
  opacityPercentMixed: _opacityPercentMixed = false,
  interactiveRefs = [],
  position = undefined,
  offsetY = -80,
  placement = 'right-start',
  closeOnScroll = false,
}: ColorPickerWrapperProps) => {
  const { t } = useTranslation();
  const initialMode = solidOnly
    ? MODES.solid
    : isGradientColor(color)
    ? MODES.gradient
    : MODES.solid;
  const [mode, setMode] = useState<string>(initialMode);
  const baseColor = normalizeColorInput(color);
  const [selectedColor, setSelectedColor] = useState<ColorObject>(
    () => toColorObject(baseColor) ?? DEFAULT_PICKER_COLOR,
  );
  const [alpha, setAlpha] = useState<number>(() =>
    extractAlphaFromColor(color),
  );
  const [alphaPercentInput, setAlphaPercentInput] = useState<string>(() =>
    String(Math.round(extractAlphaFromColor(color) * 100)),
  );
  const [isAlphaPercentFocused, setIsAlphaPercentFocused] =
    useState<boolean>(false);
  const [gradientTop, setGradientTop] = useState<string>(() =>
    isGradientColor(color)
      ? color.top.replace('#', '')
      : selectedColor.hex.replace('#', ''),
  );
  const [gradientBottom, setGradientBottom] = useState<string>(() =>
    isGradientColor(color) ? color.bottom.replace('#', '') : 'FFFFFF',
  );
  const suppressGradientResetRef = useRef<boolean>(false);
  const suppressGradientBroadcastRef = useRef<boolean>(false);
  // 드래그 중인지 추적 (드래그 중에는 외부 color prop 동기화 건너뜀)
  const isDraggingRef = useRef<boolean>(false);
  // 한번이라도 그라디언트 모드에 진입(또는 그라디언트 값을 받은) 이후엔
  // 솔리드 색상(prop)이 들어와도 그라디언트 편집 상태를 다시 시드하지 않음
  const hasSeededGradientFromSolidRef = useRef<boolean>(isGradientColor(color));

  // 사용자가 모드를 수동으로 변경했는지 추적
  const userSwitchedModeRef = useRef<boolean>(false);

  const prevColorRef = useRef<ColorValue>(color);
  // 그라디언트 Sat/Hue 편집 시 선택된 입력: 'top' | 'bottom'
  const [gradientSelected, setGradientSelected] = useState<GradientSide>(() =>
    isGradientColor(color) ? 'top' : 'top',
  );

  // 팔레트 상태
  const [solidPalette, setSolidPalette] = useState(() => loadPalette('solid'));
  const [gradientPalette, setGradientPalette] = useState(() =>
    loadPalette('gradient'),
  );

  // 현재 색상을 팔레트에 저장하는 함수
  const saveCurrentColorToPalette = () => {
    if (solidOnly || mode === MODES.solid) {
      // 솔리드 모드
      let colorToSave: string;
      if (solidOnly) {
        // solidOnly 모드: RGBA 형식으로 저장
        colorToSave = `rgba(${parseInt(
          selectedColor.hex.slice(1, 3),
          16,
        )}, ${parseInt(selectedColor.hex.slice(3, 5), 16)}, ${parseInt(
          selectedColor.hex.slice(5, 7),
          16,
        )}, ${alpha})`;
      } else {
        // 일반 솔리드 모드: hex 형식으로 저장
        colorToSave = selectedColor.hex;
      }
      addToPalette('solid', colorToSave);
      setSolidPalette(loadPalette('solid'));
    } else {
      // 그라디언트 모드
      const gradient = buildGradient(`#${gradientTop}`, `#${gradientBottom}`);
      addToPalette('gradient', gradient);
      setGradientPalette(loadPalette('gradient'));
    }
    // 신형 그라데이션 spec — 각도·스톱 위치까지 통째로 저장
    if (gradientSpec) {
      addToPalette('gradient', gradientSpecPaletteEntry(gradientSpec));
      setGradientPalette(loadPalette('gradient'));
    }
  };

  // 팔레트 클릭 핸들러 — spec 항목은 지원 피커에서만 도달 (미지원은 표시 필터)
  const handlePaletteClick = (paletteColor: PaletteValue, type: string) => {
    if (isGradientSpecColor(paletteColor)) {
      onGradientSpecSelect?.(toCanonicalGradient(paletteColor));
      return;
    }
    if (type === 'solid') {
      const parsed = parseHexColor(normalizeColorInput(paletteColor));
      if (parsed) {
        setSelectedColor(parsed);
        // RGBA인지 확인
        const newAlpha = extractAlphaFromColor(paletteColor);
        setAlpha(newAlpha);

        if (solidOnly) {
          const rgbaValue = `rgba(${parseInt(
            parsed.hex.slice(1, 3),
            16,
          )}, ${parseInt(parsed.hex.slice(3, 5), 16)}, ${parseInt(
            parsed.hex.slice(5, 7),
            16,
          )}, ${newAlpha})`;
          onColorChange?.(rgbaValue);
          onColorChangeComplete?.(rgbaValue);
        } else if (mode === MODES.gradient) {
          // 그라디언트 모드에서 솔리드 팔레트 클릭 시, 선택된 stop에 적용
          const newHex = parsed.hex.replace('#', '').toUpperCase();
          suppressGradientBroadcastRef.current = true;
          if (gradientSelected === 'top') {
            setGradientTop(newHex);
            const gradient = buildGradient(parsed.hex, `#${gradientBottom}`);
            onColorChange?.(gradient);
            onColorChangeComplete?.(gradient);
          } else {
            setGradientBottom(newHex);
            const gradient = buildGradient(`#${gradientTop}`, parsed.hex);
            onColorChange?.(gradient);
            onColorChangeComplete?.(gradient);
          }
        } else {
          onColorChange?.(parsed.hex);
          onColorChangeComplete?.(parsed.hex);
        }
      }
    } else if (type === 'gradient') {
      // 그라디언트 팔레트 클릭
      if (
        paletteColor &&
        typeof paletteColor === 'object' &&
        (paletteColor as GradientColor).type === 'gradient'
      ) {
        const gradientColor = paletteColor as GradientColor;
        // 신형 형식 피커에서는 구형(top/bottom) 항목도 spec으로 변환 적용
        if (onGradientSpecSelect) {
          onGradientSpecSelect(
            toCanonicalGradient({
              angle: 180,
              stops: [
                { color: gradientColor.top, pos: 0 },
                { color: gradientColor.bottom, pos: 1 },
              ],
            }),
          );
          return;
        }
        suppressGradientBroadcastRef.current = true;
        setGradientTop(gradientColor.top.replace('#', '').toUpperCase());
        setGradientBottom(gradientColor.bottom.replace('#', '').toUpperCase());
        setMode(MODES.gradient);
        const parsedTop = parseHexColor(gradientColor.top);
        if (parsedTop) setSelectedColor(parsedTop);
        setGradientSelected('top');
        onColorChange?.(gradientColor);
        onColorChangeComplete?.(gradientColor);
      }
    }
  };

  // onClose를 래핑하여 팔레트 저장 후 호출
  const handleClose = () => {
    saveCurrentColorToPalette();
    onClose?.();
  };

  // undo/redo 반영은 진행 중 드래그를 프리미티브가 커밋 없이 끊는다 - complete가
  // 오지 않으므로 여기서 드래그 잠금을 풀어 아래 동기화가 canonical을 따르게
  const historyTick = useCommittedApplyStore((state) => state.historyTick);
  const historyTickRef = useRef(historyTick);
  useEffect(() => {
    if (historyTickRef.current !== historyTick) {
      historyTickRef.current = historyTick;
      isDraggingRef.current = false;
    }
    // 드래그 중에는 외부 color prop 동기화 건너뜀
    if (isDraggingRef.current) {
      return;
    }

    const wasGradient = isGradientColor(prevColorRef.current);
    const isGradientNow = isGradientColor(color);

    // 사용자가 수동으로 모드를 전환한 직후에는 prop 기반 모드 전환 무시
    if (userSwitchedModeRef.current) {
      userSwitchedModeRef.current = false;
    } else {
      setMode(isGradientNow ? MODES.gradient : MODES.solid);
    }

    if (isGradientNow) {
      const topHex = color.top.replace('#', '').toUpperCase();
      const bottomHex = color.bottom.replace('#', '').toUpperCase();
      suppressGradientBroadcastRef.current = true;
      setGradientTop(topHex);
      setGradientBottom(bottomHex);
      hasSeededGradientFromSolidRef.current = true;

      const targetHex = gradientSelected === 'bottom' ? bottomHex : topHex;
      const parsedTarget = parseHexColor(targetHex);
      if (parsedTarget) {
        // 같은 색이면 유지 — hex 왕복으로 hue(360°, s=0 등)가 소실되지 않도록
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
        // 같은 색이면 hsv 유지(hex 왕복의 hue 소실 방지)하되 alpha는 병합 —
        // alpha만 바뀐 외부 변경이 슬라이더 노브에 반영되도록
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
        // RGBA에서 alpha 추출하여 설정
        const newAlpha = extractAlphaFromColor(color);
        setAlpha(newAlpha);

        if (
          !suppressGradientResetRef.current &&
          !hasSeededGradientFromSolidRef.current
        ) {
          suppressGradientBroadcastRef.current = true;
          setGradientTop(parsed.hex.replace('#', ''));
          setGradientBottom('FFFFFF');
        }
      }
      setGradientSelected('top');
      // 한 번만 억제 플래그를 사용
      suppressGradientResetRef.current = false;
    }

    prevColorRef.current = color;
  }, [color, gradientSelected, setSelectedColor, historyTick]);

  const [inputValue, setInputValue] = useState<string>(() =>
    selectedColor.hex
      .replace('#', '')
      .toUpperCase()
      .slice(0, solidOnly ? 6 : 8),
  );

  useEffect(() => {
    setInputValue(
      selectedColor.hex
        .replace('#', '')
        .toUpperCase()
        .slice(0, solidOnly ? 6 : 8),
    );
  }, [selectedColor.hex, solidOnly]);

  useEffect(() => {
    if (solidOnly && !isAlphaPercentFocused) {
      setAlphaPercentInput(String(Math.round(alpha * 100)));
    }
  }, [alpha, solidOnly, isAlphaPercentFocused]);

  // solidOnly 모드에서 Alpha 값 변경 반영 - useEffect 제거하여 무한 루프 방지
  // Alpha 슬라이더는 onChangeComplete에서 처리

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

  useEffect(() => {
    if (mode !== MODES.gradient || solidOnly) {
      return;
    }
    if (suppressGradientBroadcastRef.current) {
      suppressGradientBroadcastRef.current = false;
      return;
    }
    onColorChange?.(buildGradient(`#${gradientTop}`, `#${gradientBottom}`));
  }, [mode, gradientTop, gradientBottom, onColorChange, solidOnly]);

  const applyColor = (
    next: string | Partial<ColorObject>,
    isComplete: boolean = false,
  ) => {
    const parsed = toColorObject(next);
    if (!parsed) return;
    setSelectedColor(parsed);
    if (!solidOnly && mode === MODES.gradient) {
      // 그라디언트 모드에서 Saturation/Hue 편집 시 선택된 stop 업데이트
      const newHex = parsed.hex.replace('#', '').toUpperCase();

      suppressGradientBroadcastRef.current = true;
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
      // solidOnly 모드에서는 현재 alpha 값을 유지
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

  const handleInputChange = (raw: string) => {
    const sanitized = raw
      .replace(/[^0-9a-fA-F]/g, '')
      .slice(0, solidOnly ? 6 : 8)
      .toUpperCase();
    setInputValue(sanitized);
  };

  const commitSolidInput = () => {
    if (!inputValue) {
      setInputValue(
        selectedColor.hex
          .replace('#', '')
          .toUpperCase()
          .slice(0, solidOnly ? 6 : 8),
      );
      return;
    }

    const parsed = parseHexColor(inputValue);
    if (!parsed) {
      setInputValue(
        selectedColor.hex
          .replace('#', '')
          .toUpperCase()
          .slice(0, solidOnly ? 6 : 8),
      );
      return;
    }

    setSelectedColor(
      solidOnly
        ? {
            ...parsed,
            rgb: { ...parsed.rgb, a: alpha },
            hsv: { ...parsed.hsv, a: alpha },
          }
        : parsed,
    );

    if (solidOnly) {
      const rgbaValue = buildRgbaFromHexAndAlpha(parsed.hex, alpha);
      onColorChange?.(rgbaValue);
      onColorChangeComplete?.(rgbaValue);
    } else {
      onColorChange?.(parsed.hex);
      onColorChangeComplete?.(parsed.hex);
    }
  };

  const handleAlphaPercentChange = (raw: string) => {
    const sanitized = raw.replace(/[^0-9]/g, '').slice(0, 3);
    setAlphaPercentInput(sanitized);

    if (sanitized === '') return;
    const num = Math.min(Math.max(parseInt(sanitized, 10), 0), 100);
    setAlphaWithSync(num / 100, false);
  };

  const commitAlphaPercent = () => {
    if (!solidOnly) return;
    const raw = alphaPercentInput.trim();
    if (!raw) {
      setAlphaPercentInput(String(Math.round(alpha * 100)));
      return;
    }
    const num = Math.min(Math.max(parseInt(raw, 10), 0), 100);
    setAlphaPercentInput(String(num));
    setAlphaWithSync(num / 100, true);
  };

  const commitGradient = () => {
    const parsedTop = parseHexColor(gradientTop);
    const parsedBottom = parseHexColor(gradientBottom);
    if (!parsedTop || !parsedBottom) {
      return;
    }
    setSelectedColor(parsedTop);
    const gradient = buildGradient(parsedTop.hex, parsedBottom.hex);
    onColorChange?.(gradient);
    onColorChangeComplete?.(gradient);
  };

  const handleGradientInputChange =
    (setter: React.Dispatch<React.SetStateAction<string>>) => (raw: string) => {
      const sanitized = raw
        .replace(/[^0-9a-fA-F]/g, '')
        .slice(0, 8)
        .toUpperCase();
      setter(sanitized);
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
      // 그라디언트 -> 솔리드 전환 시, 부모로 전달되는 단색 변경에 따라
      // 내부 그라디언트 상태가 초기화되지 않도록 억제 플래그 설정
      suppressGradientResetRef.current = true;
      const parsed = parseHexColor(gradientTop || inputValue);
      if (parsed) {
        setSelectedColor(parsed);
        onColorChange?.(parsed.hex);
        onColorChangeComplete?.(parsed.hex);
      }
    } else {
      // 그라디언트 모드에 진입함을 표시(이후부터는 시드 금지)
      hasSeededGradientFromSolidRef.current = true;
      setGradientSelected('top');
      commitGradient();
    }
  };

  const showStateSwitch =
    stateMode != null && typeof onStateModeChange === 'function';

  const resolvedOpacityPercent: ResolvedOpacity | null = (() => {
    if (typeof opacityPercent === 'number' && Number.isFinite(opacityPercent)) {
      const v = opacityPercent;
      return { solid: v, top: v, bottom: v };
    }
    if (opacityPercent && typeof opacityPercent === 'object') {
      const top = Number(opacityPercent.top);
      const bottom = Number(opacityPercent.bottom);
      if (Number.isFinite(top) && Number.isFinite(bottom)) {
        return { solid: top, top, bottom };
      }
    }
    return null;
  })();

  const showOpacityControl =
    resolvedOpacityPercent !== null &&
    typeof onOpacityPercentChange === 'function';

  // 투명도 조절기의 접근성 이름 - 색 알파 슬라이더와 역할이 구분되게
  const opacityLabelText = opacityPercentLabel || 'Opacity';

  const resolvedOpacitySolid = resolvedOpacityPercent?.solid;
  const resolvedOpacityTop = resolvedOpacityPercent?.top;
  const resolvedOpacityBottom = resolvedOpacityPercent?.bottom;

  const [opacityPercentSolidInput, setOpacityPercentSolidInput] =
    useState<string>(() =>
      showOpacityControl ? String(Math.round(resolvedOpacitySolid!)) : '',
    );
  const [opacityPercentTopInput, setOpacityPercentTopInput] = useState<string>(
    () => (showOpacityControl ? String(Math.round(resolvedOpacityTop!)) : ''),
  );
  const [opacityPercentBottomInput, setOpacityPercentBottomInput] =
    useState<string>(() =>
      showOpacityControl ? String(Math.round(resolvedOpacityBottom!)) : '',
    );
  const [opacityPercentFocusTarget, setOpacityPercentFocusTarget] =
    useState<OpacityTarget | null>(null);

  useEffect(() => {
    if (!showOpacityControl) return;
    if (opacityPercentFocusTarget === 'solid') return;
    setOpacityPercentSolidInput(String(Math.round(resolvedOpacitySolid!)));
  }, [opacityPercentFocusTarget, resolvedOpacitySolid, showOpacityControl]);

  useEffect(() => {
    if (!showOpacityControl) return;
    if (opacityPercentFocusTarget === 'top') return;
    setOpacityPercentTopInput(String(Math.round(resolvedOpacityTop!)));
  }, [opacityPercentFocusTarget, resolvedOpacityTop, showOpacityControl]);

  useEffect(() => {
    if (!showOpacityControl) return;
    if (opacityPercentFocusTarget === 'bottom') return;
    setOpacityPercentBottomInput(String(Math.round(resolvedOpacityBottom!)));
  }, [opacityPercentFocusTarget, resolvedOpacityBottom, showOpacityControl]);

  const clampOpacityPercent = (value: number): number => {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    return Math.min(Math.max(Math.round(num), 0), 100);
  };

  const handleOpacityPercentSolidChange = (raw: string) => {
    if (!showOpacityControl) return;
    const sanitized = String(raw ?? '')
      .replace(/[^0-9]/g, '')
      .slice(0, 3);
    setOpacityPercentSolidInput(sanitized);

    if (sanitized === '') return;
    const num = clampOpacityPercent(Number(sanitized));
    onOpacityPercentChange?.(num, 'solid');
  };

  const handleOpacityPercentTopChange = (raw: string) => {
    if (!showOpacityControl) return;
    const sanitized = String(raw ?? '')
      .replace(/[^0-9]/g, '')
      .slice(0, 3);
    setOpacityPercentTopInput(sanitized);

    if (sanitized === '') return;
    const num = clampOpacityPercent(Number(sanitized));
    onOpacityPercentChange?.(num, 'top');
  };

  const handleOpacityPercentBottomChange = (raw: string) => {
    if (!showOpacityControl) return;
    const sanitized = String(raw ?? '')
      .replace(/[^0-9]/g, '')
      .slice(0, 3);
    setOpacityPercentBottomInput(sanitized);

    if (sanitized === '') return;
    const num = clampOpacityPercent(Number(sanitized));
    onOpacityPercentChange?.(num, 'bottom');
  };

  const commitOpacityPercentSolid = () => {
    if (!showOpacityControl) return;
    const clamped = clampOpacityPercent(Number(opacityPercentSolidInput));
    setOpacityPercentSolidInput(String(clamped));
    onOpacityPercentChange?.(clamped, 'solid');
    onOpacityPercentChangeComplete?.(clamped, 'solid');
  };

  const commitOpacityPercentTop = () => {
    if (!showOpacityControl) return;
    const clamped = clampOpacityPercent(Number(opacityPercentTopInput));
    setOpacityPercentTopInput(String(clamped));
    onOpacityPercentChange?.(clamped, 'top');
    onOpacityPercentChangeComplete?.(clamped, 'top');
  };

  const commitOpacityPercentBottom = () => {
    if (!showOpacityControl) return;
    const clamped = clampOpacityPercent(Number(opacityPercentBottomInput));
    setOpacityPercentBottomInput(String(clamped));
    onOpacityPercentChange?.(clamped, 'bottom');
    onOpacityPercentChangeComplete?.(clamped, 'bottom');
  };

  const opacitySliderTarget: OpacityTarget = (() => {
    if (solidOnly || mode === MODES.solid) return 'solid';
    return gradientSelected;
  })();

  const opacitySliderPercent: number = (() => {
    if (!showOpacityControl) return 100;
    if (opacitySliderTarget === 'solid') return resolvedOpacitySolid ?? 100;
    if (opacitySliderTarget === 'top') return resolvedOpacityTop ?? 100;
    return resolvedOpacityBottom ?? 100;
  })();

  const opacitySliderColor: ColorObject = (() => {
    if (!showOpacityControl) return selectedColor;
    const a = clampOpacityPercent(opacitySliderPercent) / 100;
    return {
      ...selectedColor,
      rgb: { ...selectedColor.rgb, a },
      hsv: { ...selectedColor.hsv, a },
    };
  })();

  return (
    <PickerSurface
      open={open}
      ariaLabel={t('noteColor.color')}
      referenceRef={referenceRef}
      panelElement={panelElement}
      fallbackWidth={168}
      fallbackHeight={300}
      cardClassName="flex flex-col p-[10px] gap-[12px] w-[168px] bg-glass-heavy backdrop-glass rounded-popup shadow-elevation-3"
      placement={placement}
      offsetY={offsetY}
      fallbackFixedX={typeof position === 'object' ? position?.x : undefined}
      fallbackFixedY={typeof position === 'object' ? position?.y : undefined}
      closeOnScroll={closeOnScroll}
      interactiveRefs={interactiveRefs}
      onClose={handleClose}
    >
      {showStateSwitch && (
        <StateSwitch state={stateMode} onChange={onStateModeChange} />
      )}
      {headerSlot}
      {!solidOnly && <ModeSwitch mode={mode} onChange={handleModeSwitch} />}

      <SaturationArea
        color={selectedColor}
        onChange={handleChange}
        onChangeComplete={handleChangeComplete}
      />

      {/* 트랙 쌍 — 그룹 간 12px / 쌍 내부 6px (모달·패널 섹션 리듬과 동일) */}
      <div className="flex flex-col gap-[6px]">
        <HueSlider
          color={selectedColor}
          onChange={handleChange}
          onChangeComplete={handleChangeComplete}
        />
        {/* 단색 형식에서 투명도 조절기가 알파를 대신하면 색 알파 슬라이더 숨김.
            그라데이션 형식에서는 색 알파가 스톱 알파라 배율과 역할이 다르다 */}
        {solidOnly && !hideColorAlpha && (
          <AlphaSlider
            color={selectedColor}
            onChange={(color: ColorObject) => {
              // Alpha 변경 시 hex 값은 유지하고 alpha만 동기화 (hex 입력 깜빡임 방지)
              setAlphaWithSync(color.rgb.a, false);
            }}
            onChangeComplete={(color: ColorObject) => {
              setAlphaWithSync(color.rgb.a, true);
            }}
          />
        )}

        {showOpacityControl && (
          <AlphaSlider
            color={opacitySliderColor}
            ariaLabel={opacityLabelText}
            onChange={(c: ColorObject) => {
              const target = opacitySliderTarget;
              const next = clampOpacityPercent((c?.rgb?.a ?? 1) * 100);
              if (
                opacityPercentFocusTarget === null ||
                opacityPercentFocusTarget !== target
              ) {
                if (target === 'solid')
                  setOpacityPercentSolidInput(String(next));
                else if (target === 'top')
                  setOpacityPercentTopInput(String(next));
                else setOpacityPercentBottomInput(String(next));
              }
              onOpacityPercentChange?.(next, target);
            }}
            onChangeComplete={(c: ColorObject) => {
              const target = opacitySliderTarget;
              const next = clampOpacityPercent((c?.rgb?.a ?? 1) * 100);
              if (target === 'solid') setOpacityPercentSolidInput(String(next));
              else if (target === 'top')
                setOpacityPercentTopInput(String(next));
              else setOpacityPercentBottomInput(String(next));
              onOpacityPercentChange?.(next, target);
              onOpacityPercentChangeComplete?.(next, target);
            }}
          />
        )}
      </div>

      {solidOnly || mode === MODES.solid ? (
        <Input
          value={inputValue}
          colorLabel={t('colorPicker.hex')}
          alphaLabel={
            // 이 필드가 전역 배율을 대신 표시하는 형식이면 이름도 배율 라벨로
            solidOnly && !hideColorAlpha
              ? t('colorPicker.alpha')
              : showOpacityControl
              ? opacityLabelText
              : t('colorPicker.alpha')
          }
          onValueChange={handleInputChange}
          onValueCommit={commitSolidInput}
          previewColor={selectedColor.hex}
          alpha={
            solidOnly && !hideColorAlpha
              ? alpha
              : showOpacityControl
              ? clampOpacityPercent(resolvedOpacitySolid!) / 100
              : undefined
          }
          alphaPercentValue={
            solidOnly && !hideColorAlpha
              ? alphaPercentInput
              : showOpacityControl
              ? opacityPercentSolidInput
              : undefined
          }
          onAlphaPercentChange={
            solidOnly && !hideColorAlpha
              ? handleAlphaPercentChange
              : showOpacityControl
              ? handleOpacityPercentSolidChange
              : undefined
          }
          onAlphaPercentCommit={
            solidOnly && !hideColorAlpha
              ? commitAlphaPercent
              : showOpacityControl
              ? commitOpacityPercentSolid
              : undefined
          }
          onAlphaPercentFocusChange={
            solidOnly && !hideColorAlpha
              ? setIsAlphaPercentFocused
              : showOpacityControl
              ? (focused: boolean) =>
                  setOpacityPercentFocusTarget(focused ? 'solid' : null)
              : undefined
          }
        />
      ) : (
        <GradientInputs
          topValue={gradientTop}
          bottomValue={gradientBottom}
          onTopChange={handleGradientInputChange(setGradientTop)}
          onBottomChange={handleGradientInputChange(setGradientBottom)}
          onTopCommit={() => {
            commitGradient();
            selectGradient('top');
          }}
          onBottomCommit={() => {
            commitGradient();
            selectGradient('bottom');
          }}
          selected={gradientSelected}
          onSelect={(s: GradientSide) => selectGradient(s)}
          rightTopValue={
            showOpacityControl ? opacityPercentTopInput : undefined
          }
          rightBottomValue={
            showOpacityControl ? opacityPercentBottomInput : undefined
          }
          onRightValueChange={
            showOpacityControl
              ? (target: GradientSide, raw: string) => {
                  if (target === 'top') handleOpacityPercentTopChange(raw);
                  else handleOpacityPercentBottomChange(raw);
                }
              : undefined
          }
          onRightCommit={
            showOpacityControl
              ? (target: GradientSide) => {
                  if (target === 'top') commitOpacityPercentTop();
                  else commitOpacityPercentBottom();
                }
              : undefined
          }
          onRightFocusChange={
            showOpacityControl
              ? (target: GradientSide, focused: boolean) =>
                  setOpacityPercentFocusTarget(focused ? target : null)
              : undefined
          }
          rightTitle={opacityPercentLabel || 'Opacity'}
        />
      )}

      {/* 팔레트 섹션 — spec 지원 피커는 solidOnly여도 그라데이션 행 표시.
            미지원(구형) 피커에서는 알파를 보존할 수 없는 spec 항목을 표시에서
            제외 (저장 데이터는 유지, 패딩 전에 필터) */}
      <ColorPaletteSection
        solidPalette={solidPalette}
        gradientPalette={
          onGradientSpecSelect
            ? gradientPalette
            : gradientPalette.filter((c) => !isGradientSpecColor(c))
        }
        onPaletteClick={handlePaletteClick}
        showGradient={!solidOnly || gradientSpec !== undefined}
      />
      {footerSlot}
    </PickerSurface>
  );
};

export default ColorPickerWrapper;

// ============================================================================
// 팔레트 컴포넌트
// ============================================================================

interface ColorPaletteSectionProps {
  solidPalette: PaletteValue[];
  gradientPalette: PaletteValue[];
  onPaletteClick: (color: PaletteValue, type: string) => void;
  showGradient: boolean;
}

function ColorPaletteSection({
  solidPalette,
  gradientPalette,
  onPaletteClick,
  showGradient,
}: ColorPaletteSectionProps) {
  const PALETTE_SIZE = 7;

  // 빈 슬롯 채우기
  const filledSolid: (PaletteValue | null)[] = [...solidPalette];
  while (filledSolid.length < PALETTE_SIZE) {
    filledSolid.push(null);
  }

  const filledGradient: (PaletteValue | null)[] = [...gradientPalette];
  while (filledGradient.length < PALETTE_SIZE) {
    filledGradient.push(null);
  }

  return (
    <div className="flex flex-col gap-[6px]">
      {/* 솔리드 팔레트 */}
      <div className="flex gap-[6px] justify-between">
        {filledSolid.map((color, index) => (
          <PaletteSlot
            key={`solid-${index}`}
            color={color}
            type="solid"
            onClick={() => color && onPaletteClick(color, 'solid')}
          />
        ))}
      </div>

      {/* 그라디언트 팔레트 (solidOnly가 아닐 때만 표시) */}
      {showGradient && (
        <div className="flex gap-[6px] justify-between">
          {filledGradient.map((color, index) => (
            <PaletteSlot
              key={`gradient-${index}`}
              color={color}
              type="gradient"
              onClick={() => color && onPaletteClick(color, 'gradient')}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface PaletteSlotProps {
  color: PaletteValue | null;
  type: string;
  onClick?: () => void;
}

function PaletteSlot({ color, type, onClick }: PaletteSlotProps) {
  const isEmpty = !color;
  const specImage = isGradientSpecColor(color)
    ? gradientToCss(toCanonicalGradient(color))
    : undefined;
  const gradient =
    type === 'gradient' &&
    color &&
    typeof color === 'object' &&
    (color as GradientColor).type === 'gradient'
      ? (color as GradientColor)
      : undefined;
  const solidColor =
    typeof color === 'string'
      ? color.startsWith('#') || color.startsWith('rgb')
        ? color
        : `#${color}`
      : isEmpty
      ? 'var(--ui-fill-faint)'
      : undefined;

  // 툴팁 텍스트 생성
  const getTitle = (): string => {
    if (isEmpty) return '';
    if (isGradientSpecColor(color)) {
      const canonical = toCanonicalGradient(color);
      const stops = canonical.stops
        .map((s) => s.color.replace('#', '').toUpperCase())
        .join('\n');
      return `${stops}\n${canonical.angle}°`;
    }
    if (
      type === 'gradient' &&
      color &&
      typeof color === 'object' &&
      (color as GradientColor).type === 'gradient'
    ) {
      const gradientColor = color as GradientColor;
      const topHex = gradientColor.top.replace('#', '').toUpperCase();
      const bottomHex = gradientColor.bottom.replace('#', '').toUpperCase();
      return `${topHex}\n${bottomHex}`;
    }
    // 솔리드 색상 툴팁 - 통일된 형식으로 표시
    if (typeof color === 'string') {
      // RGBA 형식인 경우 hex로 변환
      if (color.startsWith('rgba(')) {
        const match = color.match(
          /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/,
        );
        if (match) {
          const [, r, g, b, a] = match;
          const hexColor = `${parseInt(r)
            .toString(16)
            .padStart(2, '0')}${parseInt(g)
            .toString(16)
            .padStart(2, '0')}${parseInt(b)
            .toString(16)
            .padStart(2, '0')}${Math.round(parseFloat(a) * 255)
            .toString(16)
            .padStart(2, '0')}`.toUpperCase();
          return hexColor;
        }
      }
      // Hex 형식 - # 제거하고 대문자로
      return color.replace('#', '').toUpperCase();
    }
    return '';
  };

  return (
    <ColorSwatchButton
      type="button"
      className={`w-[16px] h-[16px] rounded transition-colors ${
        isEmpty ? 'cursor-default' : 'cursor-pointer'
      }`}
      surfaceClassName="rounded"
      color={solidColor}
      gradient={gradient}
      image={specImage}
      onClick={isEmpty ? undefined : onClick}
      disabled={isEmpty}
      title={getTitle()}
    />
  );
}

interface StateSwitchProps {
  state?: string;
  onChange?: (mode: string) => void;
}

function StateSwitch({ state, onChange }: StateSwitchProps) {
  const { t } = useTranslation();
  const idleLabel = t('colorPicker.idle') || '대기';
  const activeLabel = t('colorPicker.active') || '입력';

  return (
    <TabSwitch
      commitStrategy="after-paint"
      tabs={[
        { id: 'idle', label: idleLabel },
        { id: 'active', label: activeLabel },
      ]}
      activeTab={state ?? 'idle'}
      onTabChange={(id) => onChange?.(id)}
    />
  );
}

interface ModeSwitchProps {
  mode: string;
  onChange: (mode: string) => void;
}

function ModeSwitch({ mode, onChange }: ModeSwitchProps) {
  const { t } = useTranslation();
  const solidLabel = t('colorPicker.solid');
  const gradientLabel = t('colorPicker.gradient');
  return (
    <TabSwitch
      commitStrategy="after-paint"
      tabs={[
        { id: MODES.solid, label: solidLabel },
        { id: MODES.gradient, label: gradientLabel },
      ]}
      activeTab={mode}
      onTabChange={onChange}
    />
  );
}

interface InputProps {
  value?: string;
  colorLabel: string;
  alphaLabel: string;
  onValueChange?: (value: string) => void;
  onValueCommit?: () => void;
  previewColor?: string;
  alpha?: number;
  alphaPercentValue?: string;
  onAlphaPercentChange?: (value: string) => void;
  onAlphaPercentCommit?: () => void;
  onAlphaPercentFocusChange?: (focused: boolean) => void;
}

const Input = ({
  value = '',
  colorLabel,
  alphaLabel,
  onValueChange,
  onValueCommit,
  previewColor,
  alpha,
  alphaPercentValue,
  onAlphaPercentChange,
  onAlphaPercentCommit,
  onAlphaPercentFocusChange,
}: InputProps) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onValueChange?.(e.target.value);
  };

  return (
    <div className="flex items-center gap-[6px] w-full">
      <div className="relative flex-1 min-w-0">
        <ColorSwatchSurface
          className="absolute left-[6px] top-1/2 -translate-y-1/2 w-[11px] h-[11px] rounded-[2px]"
          color={previewColor}
          opacity={alpha}
        />
        <input
          type="text"
          aria-label={colorLabel}
          value={value}
          onChange={handleChange}
          onBlur={onValueCommit}
          onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
            if (event.key === 'Enter') {
              onValueCommit?.();
            }
          }}
          className="block pl-[23px] text-left w-full h-[23px] bg-inset rounded-md focus:shadow-focus-ring text-body text-fg uppercase"
        />
      </div>

      {alpha !== undefined && (
        <div className="w-[36px] flex-shrink-0">
          <input
            type="text"
            inputMode="numeric"
            aria-label={alphaLabel}
            value={alphaPercentValue ?? ''}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onAlphaPercentChange?.(e.target.value)
            }
            onFocus={() => onAlphaPercentFocusChange?.(true)}
            onBlur={() => {
              onAlphaPercentFocusChange?.(false);
              onAlphaPercentCommit?.();
            }}
            onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur();
              }
            }}
            className="block px-[6px] text-center w-full h-[23px] bg-inset rounded-md focus:shadow-focus-ring text-body tabular-nums text-fg"
          />
        </div>
      )}
    </div>
  );
};

interface GradientInputsProps {
  topValue: string;
  bottomValue: string;
  onTopChange: (value: string) => void;
  onBottomChange: (value: string) => void;
  onTopCommit: () => void;
  onBottomCommit: () => void;
  selected: GradientSide;
  onSelect?: (side: GradientSide) => void;
  rightTopValue?: string;
  rightBottomValue?: string;
  onRightValueChange?: (target: GradientSide, raw: string) => void;
  onRightCommit?: (target: GradientSide) => void;
  onRightFocusChange?: (target: GradientSide, focused: boolean) => void;
  rightTitle?: string;
}

function GradientInputs({
  topValue,
  bottomValue,
  onTopChange,
  onBottomChange,
  onTopCommit,
  onBottomCommit,
  selected,
  onSelect,
  rightTopValue,
  rightBottomValue,
  onRightValueChange,
  onRightCommit,
  onRightFocusChange,
  rightTitle,
}: GradientInputsProps) {
  return (
    <div className="flex flex-col gap-[6px]">
      <GradientInput
        label="Top"
        value={topValue}
        onChange={onTopChange}
        onCommit={onTopCommit}
        selected={selected === 'top'}
        onSelect={() => onSelect?.('top')}
        rightValue={rightTopValue}
        onRightValueChange={(raw: string) => onRightValueChange?.('top', raw)}
        onRightCommit={() => onRightCommit?.('top')}
        onRightFocusChange={(focused: boolean) =>
          onRightFocusChange?.('top', focused)
        }
        rightTitle={rightTitle}
      />
      <GradientInput
        label="Bottom"
        value={bottomValue}
        onChange={onBottomChange}
        onCommit={onBottomCommit}
        selected={selected === 'bottom'}
        onSelect={() => onSelect?.('bottom')}
        rightValue={rightBottomValue}
        onRightValueChange={(raw: string) =>
          onRightValueChange?.('bottom', raw)
        }
        onRightCommit={() => onRightCommit?.('bottom')}
        onRightFocusChange={(focused: boolean) =>
          onRightFocusChange?.('bottom', focused)
        }
        rightTitle={rightTitle}
      />
    </div>
  );
}

interface GradientInputProps {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  onCommit?: () => void;
  selected: boolean;
  onSelect?: () => void;
  rightValue?: string;
  onRightValueChange?: (value: string) => void;
  onRightCommit?: () => void;
  onRightFocusChange?: (focused: boolean) => void;
  rightTitle?: string;
}

function GradientInput({
  label,
  value,
  onChange,
  onCommit,
  selected,
  onSelect,
  rightValue,
  onRightValueChange,
  onRightCommit,
  onRightFocusChange,
  rightTitle,
}: GradientInputProps) {
  return (
    <div className="flex items-center gap-[6px] w-full">
      <div className="relative flex-1 min-w-0">
        <ColorSwatchSurface
          role="button"
          tabIndex={0}
          onClick={() => onSelect?.()}
          onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
            if (e.key === 'Enter') onSelect?.();
          }}
          className="absolute left-[6px] top-1/2 -translate-y-1/2 w-[11px] h-[11px] rounded-[2px]"
          color={value ? `#${value}` : '#561ecb'}
        />
        <input
          type="text"
          value={value}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
            onChange?.(event.target.value)
          }
          onFocus={() => onSelect?.()}
          onBlur={onCommit}
          onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
            if (event.key === 'Enter') {
              onCommit?.();
            }
          }}
          placeholder={label}
          className={`block pl-[23px] text-left w-full h-[23px] bg-inset rounded-md text-body text-fg uppercase ${
            selected ? 'shadow-focus-ring' : 'focus:shadow-focus-ring'
          }`}
        />
      </div>
      {rightValue !== undefined && (
        <div className="w-[36px] flex-shrink-0">
          <input
            type="text"
            inputMode="numeric"
            value={rightValue ?? ''}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onRightValueChange?.(e.target.value)
            }
            onFocus={() => onRightFocusChange?.(true)}
            onBlur={() => {
              onRightFocusChange?.(false);
              onRightCommit?.();
            }}
            onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur();
              }
            }}
            className="block px-[6px] text-center w-full h-[23px] bg-inset rounded-md focus:shadow-focus-ring text-body tabular-nums text-fg"
            title={rightTitle}
          />
        </div>
      )}
    </div>
  );
}
