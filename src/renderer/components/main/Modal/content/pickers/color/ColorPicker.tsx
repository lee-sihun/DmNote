import React, { useRef, useState } from 'react';
import { useTranslation } from '@contexts/useTranslation';
import {
  SaturationArea,
  HueSlider,
  AlphaSlider,
} from './colorPickerPrimitives';
import PickerSurface from '@components/main/Grid/PropertiesPanel/controls/PickerSurface';
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
import {
  useColorPickerInputSession,
  type ColorPickerOpacityTarget as OpacityTarget,
  type ColorPickerValue as ColorValue,
} from './useColorPickerInputSession';

// normalizeColorInput 기본색과 동일
const DEFAULT_PICKER_COLOR: ColorObject =
  parseHexColor('#561ecb') ?? hsvToColorObject({ h: 0, s: 0, v: 100, a: 1 });

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

  // undo/redo 반영은 진행 중 드래그를 프리미티브가 커밋 없이 끊는다 - complete가
  // 오지 않으므로 여기서 드래그 잠금을 풀어 아래 동기화가 canonical을 따르게
  const historyTick = useCommittedApplyStore((state) => state.historyTick);
  const {
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
  } = useColorPickerInputSession({
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
  });

  const handleClose = () => {
    flushActiveInput();
    saveCurrentColorToPalette();
    onClose?.();
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
