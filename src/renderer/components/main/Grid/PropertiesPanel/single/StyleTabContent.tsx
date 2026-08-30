import React, { useState, useRef, useEffect } from 'react';
import type { StyleTabContentProps } from '../types';
import type { EditorElementPropertyPatchV1 } from '@src/types/editor';
import type { KeyPosition } from '@src/types/key/keys';
import { PropertyRow, PropertySection, TextInput } from '../PropertyInputs';
import { useKeyStore } from '@stores/data/useKeyStore';
import ColorPicker from '../../../Modal/content/pickers/ColorPicker';
import PopupExit from '@components/main/Modal/PopupExit';
import Checkbox from '../../../common/Checkbox';
import { useGradientColorState } from '@hooks/pickers/useGradientColorState';
import {
  paintDescriptor,
  type ColorModeValue,
  type GradientSpec,
} from '@src/types/color';
import {
  DEFAULT_ELEMENT_BG,
  DEFAULT_ELEMENT_ACTIVE_BG,
  DEFAULT_ELEMENT_FONT,
  DEFAULT_ELEMENT_ACTIVE_FONT,
  DEFAULT_ELEMENT_BORDER,
  DEFAULT_ELEMENT_ACTIVE_BORDER,
} from '@utils/core/elementDefaults';
import {
  elementImageReplacesSurface,
  resolveElementBorder,
} from '@utils/core/elementBorder';
import { editGestureController } from '@src/renderer/editor/runtime/editGestureController';
import SoundSection from '../SoundSection';
import SingleGeometrySection from './SingleGeometrySection';
import SingleTypographySection from './SingleTypographySection';
import SingleSurfaceSection from './SingleSurfaceSection';
import SingleMappingSection from './SingleMappingSection';
import SingleImagePickerPopup from './SingleImagePickerPopup';

// 인-패널 서브 페이지 키 — 트리거 사이트별 유니크
const SOUND_PAGE_KEY = 'single-style:sound';

// 피커 타겟 타입
type PickerTarget = 'backgroundColor' | 'borderColor' | 'fontColor' | null;

type ColorState = 'idle' | 'active';
type StyleColorTarget = 'backgroundColor' | 'borderColor' | 'fontColor';
type GradientColorTarget = StyleColorTarget;
type ActiveStyleColorProperty =
  | 'activeBackgroundColor'
  | 'activeBorderColor'
  | 'activeFontColor';
type StyleColorProperty = StyleColorTarget | ActiveStyleColorProperty;

interface StyleTabContentInternalProps extends StyleTabContentProps {
  // 로컬 상태 (단일 선택 시에만 사용, 개별 편집 모드에서는 사용하지 않음)
  localDx?: number;
  localDy?: number;
  localWidth?: number;
  localHeight?: number;
  onLocalDxChange?: (value: number) => void;
  onLocalDyChange?: (value: number) => void;
  onLocalWidthChange?: (value: number) => void;
  onLocalHeightChange?: (value: number) => void;
}

const StyleTabContent: React.FC<StyleTabContentInternalProps> = ({
  keyIndex,
  keyPosition,
  keyCode: _keyCode,
  keyInfo,
  onGeometryPreview,
  onGeometryCommit,
  onElementPropertyCommit,
  onKeyMappingChange,
  keySlot,
  mappingControl,
  mappingControlLayout,
  mappingLabel,
  hideDisplayText = false,
  showSoundControls = true,
  shadowActiveState = true,
  showImagePicker = false,
  onToggleImagePicker,
  onInactiveImageCommit,
  onActiveImageCommit,
  onIdleTransparentCommit,
  onActiveTransparentCommit,
  onIdleImageFitCommit,
  onActiveImageFitCommit,
  onSoundPathCommit,
  onSoundEnabledCommit,
  onSoundVolumeCommit,
  onStylePropertyPreview,
  onStylePropertyCommit,
  onPaintPreview,
  onPaintCommit,
  onShadowCommit,
  imageButtonRef,
  panelElement,
  useCustomCSS = false,
  canvasAnchor,
  t,
  // 로컬 상태
  localDx,
  localDy,
  localWidth,
  localHeight,
  onLocalDxChange,
  onLocalDyChange,
  onLocalWidthChange,
  onLocalHeightChange,
}) => {
  const DEFAULT_KEY_BACKGROUND_COLOR = DEFAULT_ELEMENT_BG;
  const DEFAULT_KEY_BORDER_COLOR = DEFAULT_ELEMENT_BORDER;
  const DEFAULT_KEY_FONT_COLOR = DEFAULT_ELEMENT_FONT;
  const DEFAULT_KEY_ACTIVE_BACKGROUND_COLOR = DEFAULT_ELEMENT_ACTIVE_BG;
  const DEFAULT_KEY_ACTIVE_BORDER_COLOR = DEFAULT_ELEMENT_ACTIVE_BORDER;
  const DEFAULT_KEY_ACTIVE_FONT_COLOR = DEFAULT_ELEMENT_ACTIVE_FONT;

  // 통합 피커 상태
  const [pickerFor, setPickerFor] = useState<PickerTarget>(null);
  const [colorState, setColorState] = useState<ColorState>('idle');
  const effectiveColorState = shadowActiveState ? colorState : 'idle';
  const selectedKeyType = useKeyStore((state) => state.selectedKeyType);

  useEffect(() => {
    if (!shadowActiveState) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- stat 전환 시 active 편집 상태 즉시 폐기
      setColorState('idle');
      setPickerFor(null);
    }
  }, [shadowActiveState]);

  // 컬러 버튼 refs
  const bgColorBtnRef = useRef<HTMLButtonElement>(null);
  // 폰트 버튼 ref
  const borderColorBtnRef = useRef<HTMLButtonElement>(null);
  const fontColorBtnRef = useRef<HTMLButtonElement>(null);

  // 인-패널 내비게이션 (사운드/폰트 서브 페이지)
  // 로컬 색상 상태 (드래그 중 UI 업데이트용)
  const [localColors, setLocalColors] = useState<
    Record<StyleColorProperty, string>
  >({
    backgroundColor:
      keyPosition.backgroundColor || DEFAULT_KEY_BACKGROUND_COLOR,
    activeBackgroundColor:
      keyPosition.activeBackgroundColor ||
      keyPosition.backgroundColor ||
      DEFAULT_KEY_ACTIVE_BACKGROUND_COLOR,
    borderColor: keyPosition.borderColor || DEFAULT_KEY_BORDER_COLOR,
    activeBorderColor:
      keyPosition.activeBorderColor ||
      keyPosition.borderColor ||
      DEFAULT_KEY_ACTIVE_BORDER_COLOR,
    fontColor: keyPosition.fontColor || DEFAULT_KEY_FONT_COLOR,
    activeFontColor:
      keyPosition.activeFontColor ||
      keyPosition.fontColor ||
      DEFAULT_KEY_ACTIVE_FONT_COLOR,
  });

  // 피커가 닫혀있을 때만 외부 prop과 동기화
  useEffect(() => {
    if (
      !pickerFor ||
      (pickerFor !== 'backgroundColor' &&
        pickerFor !== 'borderColor' &&
        pickerFor !== 'fontColor')
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 닫힌 피커의 표시값을 canonical props와 동기화
      setLocalColors({
        backgroundColor:
          keyPosition.backgroundColor || DEFAULT_KEY_BACKGROUND_COLOR,
        activeBackgroundColor:
          keyPosition.activeBackgroundColor ||
          keyPosition.backgroundColor ||
          DEFAULT_KEY_ACTIVE_BACKGROUND_COLOR,
        borderColor: keyPosition.borderColor || DEFAULT_KEY_BORDER_COLOR,
        activeBorderColor:
          keyPosition.activeBorderColor ||
          keyPosition.borderColor ||
          DEFAULT_KEY_ACTIVE_BORDER_COLOR,
        fontColor: keyPosition.fontColor || DEFAULT_KEY_FONT_COLOR,
        activeFontColor:
          keyPosition.activeFontColor ||
          keyPosition.fontColor ||
          DEFAULT_KEY_ACTIVE_FONT_COLOR,
      });
    }
  }, [
    pickerFor,
    keyPosition.backgroundColor,
    keyPosition.activeBackgroundColor,
    keyPosition.borderColor,
    keyPosition.activeBorderColor,
    keyPosition.fontColor,
    keyPosition.activeFontColor,
    DEFAULT_KEY_BACKGROUND_COLOR,
    DEFAULT_KEY_ACTIVE_BACKGROUND_COLOR,
    DEFAULT_KEY_BORDER_COLOR,
    DEFAULT_KEY_ACTIVE_BORDER_COLOR,
    DEFAULT_KEY_FONT_COLOR,
    DEFAULT_KEY_ACTIVE_FONT_COLOR,
  ]);

  // interactiveRefs
  const colorPickerInteractiveRefs = [
    bgColorBtnRef,
    borderColorBtnRef,
    fontColorBtnRef,
  ];

  // 피커 토글 (같은 타겟이면 닫고, 다른 타겟이면 바로 전환)
  const handlePickerToggle = (target: PickerTarget) => {
    setPickerFor((prev) => (prev === target ? null : target));
    // 새로 열 때는 항상 대기 탭에서 시작 - 열림과 같은 배치로 리셋해
    // 첫 렌더부터 이전 "입력" 선택이 새지 않는다
    if (pickerFor !== target) setColorState('idle');
  };

  const resolveColorProperty = (
    target: StyleColorTarget,
  ): StyleColorProperty => {
    if (effectiveColorState !== 'active') return target;
    switch (target) {
      case 'backgroundColor':
        return 'activeBackgroundColor';
      case 'borderColor':
        return 'activeBorderColor';
      case 'fontColor':
        return 'activeFontColor';
      default:
        return target;
    }
  };

  const activeColorPropertyFor = (
    target: StyleColorTarget,
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

  // 상태별 저장된 gradient 형제 값
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
      default:
        return null;
    }
  };

  const isNonEmptyString = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0;

  // 현재 피커 색상값 가져오기
  const colorValueFor = (target: StyleColorTarget): string => {
    return localColors[resolveColorProperty(target)];
  };

  // 드래그 중 로컬 상태만 갱신 - preview는 그라데이션 상태(handleGradientPreview)가 담당
  const handleColorChange = (target: StyleColorTarget, color: string) => {
    const prop = resolveColorProperty(target);
    setLocalColors((prev) => ({ ...prev, [prop]: color }));
  };

  // 드래그 완료 시 로컬 반영 - 커밋은 그라데이션 상태(handleGradientCommit)가 담당
  const handleColorChangeComplete = (
    target: StyleColorTarget,
    color: string,
  ) => {
    const prop = resolveColorProperty(target);
    setLocalColors((prev) => ({ ...prev, [prop]: color }));
  };

  // ── 그라데이션 배선 (배경·테두리·글꼴 공통) ──

  const gradientTarget: GradientColorTarget | null =
    pickerFor === 'backgroundColor' ||
    pickerFor === 'borderColor' ||
    pickerFor === 'fontColor'
      ? pickerFor
      : null;

  const gradientSpecFor = (
    target: GradientColorTarget,
  ): GradientSpec | null => {
    // 테두리는 상태별 이미지 억제까지 렌더와 같은 해석기 결과를 그대로 쓴다.
    // 활성 이미지로 억제된 null이 대기 기본 립으로 되돌아가면 안 된다
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
      isNonEmptyString(keyPosition[activeProp]) || activeGradient != null;
    return activeHasValue ? activeGradient : idleGradient;
  };

  // 배경·테두리·글꼴 표면과 상태 조합을 paint 필드로
  const paintFieldFor = (target: GradientColorTarget) =>
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

  // 드래그와 텍스트 입력은 같은 preview patch를 사용
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
    // 요소 종류·키 모드 포함 — 형식 왕복 기억이 다른 대상과 교차하지 않게
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

  // 타이핑 중 스타일 프리뷰
  const handleStylePreview = (
    property: keyof KeyPosition,
    value: KeyPosition[keyof KeyPosition],
  ) => {
    if (
      onStylePropertyPreview &&
      (property === 'borderWidth' ||
        property === 'borderRadius' ||
        property === 'fontSize') &&
      typeof value === 'number'
    ) {
      onStylePropertyPreview(
        property === 'borderWidth'
          ? { property: 'borderWidth', value }
          : property === 'borderRadius'
          ? { property: 'borderRadius', value }
          : { property: 'fontSize', value },
      );
      return;
    }
  };

  const handleStyleChangeComplete = (
    property: keyof KeyPosition,
    value: KeyPosition[keyof KeyPosition],
    options?: { gestureId?: string },
  ) => {
    if (
      onStylePropertyCommit &&
      (property === 'borderWidth' ||
        property === 'borderRadius' ||
        property === 'fontSize') &&
      typeof value === 'number'
    ) {
      onStylePropertyCommit(
        property === 'borderWidth'
          ? { property: 'borderWidth', value }
          : property === 'borderRadius'
          ? { property: 'borderRadius', value }
          : { property: 'fontSize', value },
      );
      return;
    }
    // property와 value의 상관은 TS가 못 잡아 캐스트가 남는다. 모양은 wire 계약과
    // 같고 값 유효성은 하류 검증이 잡는다. 단일 키 객체를 보내면 조용히 폐기된다
    onElementPropertyCommit?.(
      {
        property,
        value,
      } as EditorElementPropertyPatchV1,
      options,
    );
  };

  // 클래스명 핸들러
  const handleClassNameChange = (value: string) => {
    onStylePropertyPreview?.({ property: 'className', value: value });
  };

  const handleClassNameBlur = (value: string) => {
    onStylePropertyCommit?.({ property: 'className', value: value });
  };

  // 색상 표시용 헬퍼 함수
  const getDisplayColor = (color: string): string => {
    if (!color) return '#ffffff';
    if (color.startsWith('rgba') || color.startsWith('rgb')) return color;
    if (color.startsWith('#')) return color;
    return '#ffffff';
  };

  return (
    <>
      <SingleMappingSection
        keyIndex={keyIndex}
        keySlot={keySlot}
        onKeyMappingChange={onKeyMappingChange}
        mappingControl={mappingControl}
        mappingControlLayout={mappingControlLayout}
        mappingLabel={mappingLabel}
        panelElement={panelElement}
        t={t}
      />

      <SingleGeometrySection
        keyPosition={keyPosition}
        localDx={localDx}
        localDy={localDy}
        localWidth={localWidth}
        localHeight={localHeight}
        onLocalDxChange={onLocalDxChange}
        onLocalDyChange={onLocalDyChange}
        onLocalWidthChange={onLocalWidthChange}
        onLocalHeightChange={onLocalHeightChange}
        onGeometryPreview={onGeometryPreview}
        onGeometryCommit={onGeometryCommit}
        t={t}
      />

      <SingleSurfaceSection
        keyPosition={keyPosition}
        backgroundColorButtonRef={bgColorBtnRef}
        borderColorButtonRef={borderColorBtnRef}
        backgroundColorOpen={pickerFor === 'backgroundColor'}
        borderColorOpen={pickerFor === 'borderColor'}
        backgroundColor={getDisplayColor(colorValueFor('backgroundColor'))}
        borderColor={getDisplayColor(colorValueFor('borderColor'))}
        backgroundGradient={gradientSpecFor('backgroundColor')}
        borderGradient={gradientSpecFor('borderColor')}
        onBackgroundColorToggle={() => handlePickerToggle('backgroundColor')}
        onBorderColorToggle={() => handlePickerToggle('borderColor')}
        showImagePicker={showImagePicker}
        imageButtonRef={imageButtonRef}
        onToggleImagePicker={onToggleImagePicker}
        shadowActiveState={shadowActiveState}
        canvasAnchor={canvasAnchor}
        panelElement={panelElement}
        onStylePreview={(patch) => onStylePropertyPreview?.(patch)}
        onBorderWidthCommit={(value) =>
          handleStyleChangeComplete('borderWidth', value)
        }
        onBorderRadiusCommit={(value) =>
          handleStyleChangeComplete('borderRadius', value)
        }
        onShadowCommit={onShadowCommit}
        t={t}
      />

      <SingleTypographySection
        keyPosition={keyPosition}
        keyInfo={keyInfo}
        hideDisplayText={hideDisplayText}
        fontColorButtonRef={fontColorBtnRef}
        fontColorOpen={pickerFor === 'fontColor'}
        fontColor={getDisplayColor(colorValueFor('fontColor'))}
        onFontColorToggle={() => handlePickerToggle('fontColor')}
        onBeforeFontOpen={() => setPickerFor(null)}
        onDisplayTextPreview={(value) =>
          onStylePropertyPreview?.({ property: 'displayText', value })
        }
        onDisplayTextCommit={(value) =>
          onStylePropertyCommit?.({ property: 'displayText', value })
        }
        onStylePreview={handleStylePreview}
        onStyleCommit={handleStyleChangeComplete}
        t={t}
      />

      {/* 커스텀 CSS 활성화 시에만 클래스명 및 CSS 우선순위 표시 */}
      {useCustomCSS && (
        <PropertySection>
          {/* CSS 우선순위 토글 */}
          <div className="flex justify-between items-center w-full min-h-[32px]">
            <p className="text-fg-muted text-label">
              {t('propertiesPanel.useInlineStyles') || '인라인 스타일 우선'}
            </p>
            <Checkbox
              commitStrategy="after-paint"
              checked={keyPosition.useInlineStyles ?? false}
              onChange={() =>
                handleStyleChangeComplete(
                  'useInlineStyles',
                  !(keyPosition.useInlineStyles ?? false),
                )
              }
            />
          </div>

          {/* 클래스명 */}
          <PropertyRow label={t('propertiesPanel.className') || '클래스'}>
            <TextInput
              value={keyPosition.className || ''}
              onChange={handleClassNameChange}
              onBlur={handleClassNameBlur}
              onCancel={() => editGestureController.cancel()}
              placeholder="className"
              width="90px"
            />
          </PropertyRow>
        </PropertySection>
      )}

      {showSoundControls && (
        <SoundSection
          pageKey={SOUND_PAGE_KEY}
          completionBinding="element-id"
          soundEnabled={{
            value: keyPosition.soundEnabled ?? false,
            isMixed: false,
          }}
          soundPath={{ value: keyPosition.soundPath || '', isMixed: false }}
          soundVolume={{
            value: keyPosition.soundVolume ?? 100,
            isMixed: false,
          }}
          onSoundEnabledCommit={(value) => onSoundEnabledCommit?.(value)}
          onSoundPathCommit={(value) => onSoundPathCommit?.(value)}
          onSoundVolumeCommit={(value) => {
            if (onSoundVolumeCommit) onSoundVolumeCommit(value);
            else handleStyleChangeComplete('soundVolume', value);
          }}
          onSoundVolumePreview={(value) =>
            handleStylePreview('soundVolume', value)
          }
          onSoundVolumeCancel={() => editGestureController.cancel()}
          onBeforeToggle={() => setPickerFor(null)}
          t={t}
        />
      )}

      <SingleImagePickerPopup
        open={showImagePicker}
        keyPosition={keyPosition}
        imageButtonRef={imageButtonRef}
        panelElement={panelElement}
        canvasAnchor={canvasAnchor}
        showActiveState={shadowActiveState}
        onToggle={onToggleImagePicker}
        onInactiveImageCommit={onInactiveImageCommit}
        onActiveImageCommit={onActiveImageCommit}
        onIdleTransparentCommit={onIdleTransparentCommit}
        onActiveTransparentCommit={onActiveTransparentCommit}
        onIdleImageFitCommit={onIdleImageFitCommit}
        onActiveImageFitCommit={onActiveImageFitCommit}
        onElementPropertyCommit={onElementPropertyCommit}
        onStylePropertyPreview={onStylePropertyPreview}
      />

      {/* 통합 ColorPicker - 단일 인스턴스로 깜빡임 없이 전환 */}
      <PopupExit open={Boolean(pickerFor)}>
        {pickerFor ? (
          <ColorPicker
            open={!!pickerFor}
            referenceRef={
              pickerFor === 'backgroundColor'
                ? bgColorBtnRef
                : pickerFor === 'borderColor'
                ? borderColorBtnRef
                : fontColorBtnRef
            }
            panelElement={panelElement}
            color={
              gradientTarget
                ? gradientState.pickerColor
                : colorValueFor(pickerFor as StyleColorTarget)
            }
            onColorChange={(c: string) =>
              gradientTarget
                ? gradientState.handlePickerColorChange(c, false)
                : handleColorChange(pickerFor as StyleColorTarget, c)
            }
            onColorChangeComplete={(c: string) =>
              gradientTarget
                ? gradientState.handlePickerColorChange(c, true)
                : handleColorChangeComplete(pickerFor as StyleColorTarget, c)
            }
            onInputCancel={(_target, restoredColor) => {
              gradientState.cancelPreview();
              if (typeof restoredColor === 'string') {
                const prop = resolveColorProperty(
                  pickerFor as StyleColorTarget,
                );
                setLocalColors((prev) => ({
                  ...prev,
                  [prop]: restoredColor,
                }));
              }
              editGestureController.cancel();
            }}
            onClose={() => setPickerFor(null)}
            solidOnly={true}
            stateMode={shadowActiveState ? effectiveColorState : undefined}
            onStateModeChange={shadowActiveState ? setColorState : undefined}
            interactiveRefs={colorPickerInteractiveRefs}
            headerSlot={gradientTarget ? gradientState.headerSlot : undefined}
            footerSlot={gradientTarget ? gradientState.footerSlot : undefined}
            gradientSpec={
              gradientTarget ? gradientState.paletteGradientSpec : undefined
            }
            onGradientSpecSelect={
              gradientTarget
                ? gradientState.handleGradientSpecSelect
                : undefined
            }
          />
        ) : null}
      </PopupExit>
    </>
  );
};

export default StyleTabContent;
