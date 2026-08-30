/* eslint-disable react-hooks/set-state-in-effect */
import React, { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from '@contexts/useTranslation';
import {
  SaturationArea,
  HueSlider,
  AlphaSlider,
} from './colorPickerPrimitives';
import PickerSurface from '@components/main/Grid/PropertiesPanel/PickerSurface';
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
} from '@utils/color/colorPaletteStorage';
import { toCanonicalGradient, type GradientSpec } from '@src/types/color';
import { useCommittedApplyStore } from '@stores/data/useCommittedApplyStore';
import {
  ColorInput as Input,
  GradientInputs,
  type GradientSide,
  type PercentInputProps,
} from './ColorPickerInputs';
import {
  ColorPaletteSection,
  ModeSwitch,
  StateSwitch,
  type PaletteValue,
} from './ColorPickerControls';

type ColorValue = string | GradientColor;

// normalizeColorInput 기본색과 동일
const DEFAULT_PICKER_COLOR: ColorObject =
  parseHexColor('#561ecb') ?? hsvToColorObject({ h: 0, s: 0, v: 100, a: 1 });
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
  /** % 입력의 Escape 원복. 배치 편집은 게스처 취소로만 항목별 값을 되살릴 수 있다 */
  onOpacityPercentCancel?: (target: OpacityTarget) => void;
  /** hex/solid alpha 입력의 Escape 원복. 피커는 로컬 시작값을, 호출부는 preview 세션을 되돌린다 */
  onInputCancel?: (target: OpacityTarget, restoredColor: ColorValue) => void;
  opacityPercentLabel?: string;
  /** 배치 선택의 % 칸 값(opacity 또는 solidOnly alpha)이 서로 다르면 대표값 대신 Mixed.
   *  그라데이션은 상·하단이 따로 갈릴 수 있어 객체도 받는다 */
  opacityPercentMixed?: boolean | { top: boolean; bottom: boolean };
  /** 배치 선택의 hex가 서로 다르면 hex 칸이 Mixed. 손대지 않은 blur는 확정하지 않는다 */
  hexMixed?: boolean;
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
  onOpacityPercentCancel = undefined,
  onInputCancel = undefined,
  opacityPercentLabel = undefined,
  opacityPercentMixed = false,
  hexMixed = false,
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
  const [gradientTop, setGradientTop] = useState<string>(() =>
    isGradientColor(color)
      ? color.top.replace('#', '')
      : selectedColor.hex.replace('#', ''),
  );
  const [gradientBottom, setGradientBottom] = useState<string>(() =>
    isGradientColor(color) ? color.bottom.replace('#', '') : 'FFFFFF',
  );
  const suppressGradientResetRef = useRef<boolean>(false);
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
    const ownerDocument = referenceRef.current?.ownerDocument ?? document;
    const active = ownerDocument.activeElement;
    if (
      active?.matches('input, textarea') &&
      active.closest('[role="dialog"]')
    ) {
      flushSync(() => (active as HTMLElement).blur());
    }
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

  // 이번 편집에서 hex를 실제로 쳤는지. Mixed 상태에서 손대지 않은 blur가
  // 대표값을 선택 전체에 확정해 항목별 값을 지우는 일을 막는다
  const hexDirtyRef = useRef(false);
  const solidInputEditRef = useRef<{
    inputValue: string;
    color: ColorValue;
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
    // Mixed 필드는 빈 칸에서 시작한다. 대표값을 띄우면 공통값처럼 읽힌다
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

  // 입력은 NumberInput이 0~100으로 재운 값만 넘긴다
  const previewAlphaPercent = (percent: number) => {
    setAlphaWithSync(percent / 100, false);
  };

  const commitAlphaPercent = (percent: number) => {
    setAlphaWithSync(percent / 100, true);
  };

  // Escape 원복 기준. Mixed에서는 NumberInput이 대표값을 다시 발행하지 않으므로
  // 편집 전 alpha를 여기서 기억해 두었다가 되돌린다
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
      // 호출부가 게스처를 가지면 preview를 내지 않고 조용히 되돌린 뒤 맡긴다.
      // 대표값 preview는 선택 전체를 평탄화한다
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

  // 피커가 색 알파를 직접 소유하는 동안은 호출부 opacity 제어와 함께 켜지지 않는다.
  // hideColorAlpha면 호출부 투명도가 알파를 대신한다
  const ownsColorAlpha = solidOnly && !hideColorAlpha;
  const showOpacityControl =
    !ownsColorAlpha &&
    resolvedOpacityPercent !== null &&
    typeof onOpacityPercentChange === 'function';

  // 투명도 조절기의 접근성 이름 - 색 알파 슬라이더와 역할이 구분되게
  const opacityLabelText = opacityPercentLabel || 'Opacity';

  const resolvedOpacitySolid = resolvedOpacityPercent?.solid;
  const resolvedOpacityTop = resolvedOpacityPercent?.top;
  const resolvedOpacityBottom = resolvedOpacityPercent?.bottom;

  const clampOpacityPercent = (value: number): number => {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    return Math.min(Math.max(Math.round(num), 0), 100);
  };

  const previewOpacityPercent = (target: OpacityTarget, percent: number) => {
    onOpacityPercentChange?.(clampOpacityPercent(percent), target);
  };

  const commitOpacityPercent = (target: OpacityTarget, percent: number) => {
    const clamped = clampOpacityPercent(percent);
    onOpacityPercentChange?.(clamped, target);
    onOpacityPercentChangeComplete?.(clamped, target);
  };

  const opacityMixedFor = (target: OpacityTarget): boolean => {
    if (typeof opacityPercentMixed === 'boolean') return opacityPercentMixed;
    if (target === 'top') return opacityPercentMixed.top;
    if (target === 'bottom') return opacityPercentMixed.bottom;
    return opacityPercentMixed.top || opacityPercentMixed.bottom;
  };

  // 배치 값의 반대 축이 Mixed면 대표값으로 그 축을 덮지 않도록 잠근다.
  // 알파를 색에 실어 보내는 형식(ownsColorAlpha)에서만 - hideColorAlpha면 색 알파는
  // 저장 때 버려져 opacity Mixed와 무관한데 잠그면 색을 아예 못 바꾼다.
  // 두 축 모두 Mixed면 지킬 공통값이 없으므로 잠금을 풀어 막다른 길을 없앤다
  // (Mixed 칸 편집 = 전체 적용은 다른 Mixed 입력과 같은 규칙)
  const bothAxesMixed = hexMixed && opacityMixedFor('solid');
  const rgbEditingDisabled =
    ownsColorAlpha && !bothAxesMixed && opacityMixedFor('solid');
  const alphaEditingDisabled = ownsColorAlpha && !bothAxesMixed && hexMixed;

  const opacityPercentControl = (
    target: OpacityTarget,
  ): PercentInputProps | undefined =>
    showOpacityControl && resolvedOpacityPercent
      ? {
          value: resolvedOpacityPercent[target],
          label: opacityLabelText,
          isMixed: opacityMixedFor(target),
          onPreview: (percent) => previewOpacityPercent(target, percent),
          onCommit: (percent) => commitOpacityPercent(target, percent),
          onCancel: onOpacityPercentCancel
            ? () => onOpacityPercentCancel(target)
            : undefined,
        }
      : undefined;

  // 색 알파를 소유하면 피커 alpha를, 아니면 호출부의 opacity를 편집한다
  const solidPercentControl: PercentInputProps | undefined = ownsColorAlpha
    ? {
        value: Math.round(alpha * 100),
        label: t('colorPicker.alpha'),
        isMixed: opacityMixedFor('solid'),
        disabled: alphaEditingDisabled,
        onEditStart: startAlphaEdit,
        onPreview: previewAlphaPercent,
        onCommit: commitAlphaPercent,
        onCancel: cancelAlphaPercent,
      }
    : opacityPercentControl('solid');

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
      cardClassName="flex flex-col p-[10px] gap-[12px] w-[168px] rounded-popup"
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
        disabled={rgbEditingDisabled}
        onChange={handleChange}
        onChangeComplete={handleChangeComplete}
      />

      {/* 트랙 쌍 — 그룹 간 12px / 쌍 내부 6px (모달·패널 섹션 리듬과 동일) */}
      <div className="flex flex-col gap-[6px]">
        <HueSlider
          color={selectedColor}
          disabled={rgbEditingDisabled}
          onChange={handleChange}
          onChangeComplete={handleChangeComplete}
        />
        {/* 단색 형식에서 투명도 조절기가 알파를 대신하면 색 알파 슬라이더 숨김.
            그라데이션 형식에서는 색 알파가 스톱 알파라 배율과 역할이 다르다 */}
        {solidOnly && !hideColorAlpha && (
          <AlphaSlider
            color={selectedColor}
            disabled={alphaEditingDisabled}
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
              previewOpacityPercent(
                opacitySliderTarget,
                (c?.rgb?.a ?? 1) * 100,
              );
            }}
            onChangeComplete={(c: ColorObject) => {
              commitOpacityPercent(opacitySliderTarget, (c?.rgb?.a ?? 1) * 100);
            }}
          />
        )}
      </div>

      {solidOnly || mode === MODES.solid ? (
        <Input
          value={inputValue}
          ariaLabel={t('colorPicker.hex')}
          mixed={hexMixed}
          disabled={rgbEditingDisabled}
          onValueChange={handleInputChange}
          onValueFocus={startSolidInputEdit}
          onValueCommit={commitSolidInput}
          onValueCancel={cancelSolidInput}
          previewColor={selectedColor.hex}
          alpha={
            solidOnly && !hideColorAlpha
              ? alpha
              : showOpacityControl && resolvedOpacityPercent
              ? clampOpacityPercent(resolvedOpacityPercent.solid) / 100
              : undefined
          }
          alphaPercent={solidPercentControl}
        />
      ) : (
        <GradientInputs
          topValue={gradientTop}
          bottomValue={gradientBottom}
          colorLabel={t('noteColor.color')}
          onTopChange={(value) => handleGradientInputChange('top', value)}
          onBottomChange={(value) => handleGradientInputChange('bottom', value)}
          onTopFocus={() => startGradientInputEdit('top')}
          onBottomFocus={() => startGradientInputEdit('bottom')}
          onTopCommit={() => commitGradientInput('top')}
          onBottomCommit={() => commitGradientInput('bottom')}
          onTopCancel={() => cancelGradientInput('top')}
          onBottomCancel={() => cancelGradientInput('bottom')}
          selected={gradientSelected}
          onSelect={(s: GradientSide) => selectGradient(s)}
          rightTopPercent={opacityPercentControl('top')}
          rightBottomPercent={opacityPercentControl('bottom')}
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
        solidLocked={rgbEditingDisabled || alphaEditingDisabled}
      />
      {footerSlot}
    </PickerSurface>
  );
};

export default ColorPickerWrapper;
