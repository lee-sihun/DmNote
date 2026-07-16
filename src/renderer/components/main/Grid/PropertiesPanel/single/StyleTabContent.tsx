/* eslint-disable react-hooks/set-state-in-effect */
import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { StyleTabContentProps } from '../types';
import type { ImageFit, KeyPosition } from '@src/types/key/keys';
import {
  PropertyRow,
  PropertySection,
  NumberInput,
  TextInput,
  FontStyleToggle,
} from '../PropertyInputs';
import { usePanelNav } from '../PanelNavContext';
import ImagePicker from '../../../Modal/content/pickers/ImagePicker';
import ColorPicker from '../../../Modal/content/pickers/ColorPicker';
import FontPicker from '../../../Modal/content/pickers/FontPicker';
import SoundPicker from '../../../Modal/content/pickers/SoundPicker';
import Checkbox from '../../../common/Checkbox';
import { ColorSwatchButton } from '../../../Modal/content/pickers/ColorSwatch';

// 인-패널 서브 페이지 키 — 트리거 사이트별 유니크
const FONT_PAGE_KEY = 'single-style:font';
const SOUND_PAGE_KEY = 'single-style:sound';

// 피커 타겟 타입
type PickerTarget =
  | 'backgroundColor'
  | 'borderColor'
  | 'fontColor'
  | 'image'
  | null;

type ColorState = 'idle' | 'active';
type StyleColorTarget = 'backgroundColor' | 'borderColor' | 'fontColor';
type ActiveStyleColorProperty =
  | 'activeBackgroundColor'
  | 'activeBorderColor'
  | 'activeFontColor';
type StyleColorProperty =
  | StyleColorTarget
  | 'activeBackgroundColor'
  | 'activeBorderColor'
  | 'activeFontColor';

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
  onSizeBlur?: () => void;
}

const StyleTabContent: React.FC<StyleTabContentInternalProps> = ({
  keyIndex,
  keyPosition,
  keyCode: _keyCode,
  keyInfo,
  onPositionChange,
  onKeyUpdate,
  onKeyPreview,
  onKeyMappingChange: _onKeyMappingChange,
  isListening = false,
  onKeyListen,
  mappingControl,
  mappingControlLayout,
  mappingLabel,
  hideDisplayText = false,
  showSoundControls = true,
  showImagePicker = false,
  onToggleImagePicker,
  imageButtonRef,
  panelElement,
  useCustomCSS = false,
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
  onSizeBlur,
}) => {
  const DEFAULT_KEY_BACKGROUND_COLOR = 'rgba(46, 46, 47, 0.9)';
  const DEFAULT_KEY_BORDER_COLOR = 'rgba(113, 113, 113, 0.9)';
  const DEFAULT_KEY_FONT_COLOR = 'rgba(121, 121, 121, 0.9)';
  const DEFAULT_KEY_ACTIVE_BACKGROUND_COLOR = 'rgba(121, 121, 121, 0.9)';
  const DEFAULT_KEY_ACTIVE_BORDER_COLOR = 'rgba(255, 255, 255, 0.9)';
  const DEFAULT_KEY_ACTIVE_FONT_COLOR = '#FFFFFF';

  // 개별 편집 모드인지 확인 (로컬 상태 핸들러가 없으면 개별 편집 모드)
  const isIndividualMode = !onLocalDxChange;

  // 통합 피커 상태
  const [pickerFor, setPickerFor] = useState<PickerTarget>(null);
  const [colorState, setColorState] = useState<ColorState>('idle');

  // 컬러 버튼 refs
  const bgColorBtnRef = useRef<HTMLButtonElement>(null);
  // 폰트 버튼 ref
  const borderColorBtnRef = useRef<HTMLButtonElement>(null);
  const fontColorBtnRef = useRef<HTMLButtonElement>(null);
  const internalImageButtonRef = useRef<HTMLButtonElement>(null);

  // 인-패널 내비게이션 (사운드/폰트 서브 페이지)
  const { activePageKey, renderPageKey, openPage, closePage, pageHost } =
    usePanelNav();

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

  // 실제 사용할 이미지 버튼 ref (외부에서 제공되면 외부 것 사용)
  const _actualImageButtonRef = imageButtonRef || internalImageButtonRef;

  // 피커 토글 (같은 타겟이면 닫고, 다른 타겟이면 바로 전환)
  const handlePickerToggle = (target: PickerTarget) => {
    setPickerFor((prev) => (prev === target ? null : target));
  };

  // 이미지 피커 토글 (외부 핸들러가 있으면 사용, 없으면 내부 상태 사용)
  const _handleImagePickerToggle = () => {
    if (onToggleImagePicker) {
      onToggleImagePicker();
      setPickerFor(null); // 다른 피커 닫기
    } else {
      handlePickerToggle('image');
    }
  };

  const resolveColorProperty = (
    target: StyleColorTarget,
  ): StyleColorProperty => {
    if (colorState !== 'active') return target;
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

  const isNonEmptyString = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0;

  // 현재 피커 색상값 가져오기
  const colorValueFor = (target: StyleColorTarget): string => {
    return localColors[resolveColorProperty(target)];
  };

  // 드래그 중 로컬 상태만 업데이트
  const handleColorChange = (target: StyleColorTarget, color: string) => {
    const prop = resolveColorProperty(target);
    setLocalColors((prev) => ({ ...prev, [prop]: color }));
  };

  // 드래그 완료 시 부모에게 전달
  const handleColorChangeComplete = (
    target: StyleColorTarget,
    color: string,
  ) => {
    const prop = resolveColorProperty(target);
    setLocalColors((prev) => ({ ...prev, [prop]: color }));

    const updates: Partial<KeyPosition> = {
      [prop]: color,
    } as Partial<KeyPosition>;

    // "idle" 상태에서만 변경했을 때 active 값이 비어 있으면,
    // 현재 표시되던 active 값을 함께 저장해(active가 idle로 덮이는 현상 방지)
    if (colorState !== 'active') {
      const activeProp = activeColorPropertyFor(target);
      const currentActive = keyPosition[activeProp];
      if (!isNonEmptyString(currentActive)) {
        updates[activeProp] = localColors[activeProp];
      }
    }

    onKeyUpdate({ index: keyIndex, ...updates });
  };

  // 위치 변경 핸들러
  const handlePositionXChange = (value: number) => {
    if (onLocalDxChange) {
      onLocalDxChange(value);
    }
    onPositionChange(keyIndex, value, localDy ?? keyPosition.dy);
  };

  const handlePositionYChange = (value: number) => {
    if (onLocalDyChange) {
      onLocalDyChange(value);
    }
    onPositionChange(keyIndex, localDx ?? keyPosition.dx, value);
  };

  // 크기 변경 핸들러
  const handleWidthChange = (value: number) => {
    if (onLocalWidthChange) {
      onLocalWidthChange(value);
      onKeyPreview?.(keyIndex, { width: value });
    } else {
      onKeyUpdate({ index: keyIndex, width: value });
    }
  };

  const handleHeightChange = (value: number) => {
    if (onLocalHeightChange) {
      onLocalHeightChange(value);
      onKeyPreview?.(keyIndex, { height: value });
    } else {
      onKeyUpdate({ index: keyIndex, height: value });
    }
  };

  // 스타일 변경 핸들러
  const _handleStyleChange = (
    property: keyof KeyPosition,
    value: KeyPosition[keyof KeyPosition],
  ) => {
    onKeyPreview?.(keyIndex, { [property]: value });
  };

  const handleStyleChangeComplete = (
    property: keyof KeyPosition,
    value: KeyPosition[keyof KeyPosition],
  ) => {
    onKeyUpdate({ index: keyIndex, [property]: value });
  };

  // 이미지 변경 핸들러
  const handleIdleImageChange = (imageUrl: string) => {
    onKeyPreview?.(keyIndex, { inactiveImage: imageUrl });
    onKeyUpdate({ index: keyIndex, inactiveImage: imageUrl });
  };

  const handleActiveImageChange = (imageUrl: string) => {
    onKeyPreview?.(keyIndex, { activeImage: imageUrl });
    onKeyUpdate({ index: keyIndex, activeImage: imageUrl });
  };

  const handleIdleTransparentChange = (checked: boolean) => {
    onKeyPreview?.(keyIndex, { idleTransparent: checked });
    onKeyUpdate({ index: keyIndex, idleTransparent: checked });
  };

  const handleActiveTransparentChange = (checked: boolean) => {
    onKeyPreview?.(keyIndex, { activeTransparent: checked });
    onKeyUpdate({ index: keyIndex, activeTransparent: checked });
  };

  const handleIdleImageReset = () => {
    onKeyPreview?.(keyIndex, { inactiveImage: '' });
    onKeyUpdate({ index: keyIndex, inactiveImage: '' });
  };

  const handleActiveImageReset = () => {
    onKeyPreview?.(keyIndex, { activeImage: '' });
    onKeyUpdate({ index: keyIndex, activeImage: '' });
  };

  const handleIdleImageFitChange = (fit: ImageFit) => {
    onKeyPreview?.(keyIndex, { idleImageFit: fit });
    onKeyUpdate({ index: keyIndex, idleImageFit: fit });
  };

  const handleActiveImageFitChange = (fit: ImageFit) => {
    onKeyPreview?.(keyIndex, { activeImageFit: fit });
    onKeyUpdate({ index: keyIndex, activeImageFit: fit });
  };

  // 표시 텍스트 핸들러
  const handleDisplayTextChange = (value: string) => {
    onKeyPreview?.(keyIndex, { displayText: value });
  };

  const handleDisplayTextBlur = () => {
    onKeyUpdate({
      index: keyIndex,
      displayText: keyPosition.displayText || '',
    });
  };

  // 클래스명 핸들러
  const handleClassNameChange = (value: string) => {
    onKeyPreview?.(keyIndex, { className: value });
  };

  const handleClassNameBlur = () => {
    onKeyUpdate({ index: keyIndex, className: keyPosition.className || '' });
  };

  // 이미지 피커 열림 상태 (외부 또는 내부)
  const _isImagePickerOpen = onToggleImagePicker
    ? showImagePicker
    : pickerFor === 'image';

  // 색상 표시용 헬퍼 함수
  const getDisplayColor = (color: string): string => {
    if (!color) return '#ffffff';
    if (color.startsWith('rgba') || color.startsWith('rgb')) return color;
    if (color.startsWith('#')) return color;
    return '#ffffff';
  };

  return (
    <>
      {/* 키 매핑(또는 통계 종류 등 대체 컨트롤) - 단일 선택 모드에서만 표시 */}
      {mappingControlLayout ? (
        <PropertySection>{mappingControlLayout}</PropertySection>
      ) : mappingControl ? (
        <PropertySection>
          <PropertyRow
            label={mappingLabel || t('propertiesPanel.keyMapping') || '키 매핑'}
          >
            {mappingControl}
          </PropertyRow>
        </PropertySection>
      ) : onKeyListen ? (
        <PropertySection>
          <PropertyRow label={t('propertiesPanel.keyMapping') || '키 매핑'}>
            <button
              onClick={onKeyListen}
              className={`flex items-center justify-center h-[23px] min-w-[0px] px-[8px] bg-fill hover:bg-fill-hover active:bg-fill-active transition-colors duration-fast rounded-md ${
                isListening ? 'shadow-focus-ring' : ''
              } text-fg text-label`}
            >
              {isListening
                ? t('propertiesPanel.pressAnyKey') || 'Press any key'
                : keyInfo?.displayName ||
                  t('propertiesPanel.clickToSet') ||
                  'Click to set'}
            </button>
          </PropertyRow>
        </PropertySection>
      ) : null}

      {/* 위치·크기 */}
      <PropertySection>
        <PropertyRow label={t('propertiesPanel.position') || '위치'}>
          <NumberInput
            value={
              isIndividualMode ? keyPosition.dx : localDx ?? keyPosition.dx
            }
            onChange={handlePositionXChange}
            prefix="X"
            min={-9999}
            max={9999}
            allowDecimal
            decimalScale={1}
          />
          <NumberInput
            value={
              isIndividualMode ? keyPosition.dy : localDy ?? keyPosition.dy
            }
            onChange={handlePositionYChange}
            prefix="Y"
            min={-9999}
            max={9999}
            allowDecimal
            decimalScale={1}
          />
        </PropertyRow>

        {/* 크기 */}
        <PropertyRow label={t('propertiesPanel.size') || '크기'}>
          <NumberInput
            value={
              isIndividualMode
                ? keyPosition.width ?? 60
                : localWidth ?? keyPosition.width ?? 60
            }
            onChange={handleWidthChange}
            onBlur={onSizeBlur}
            prefix="W"
            min={1}
            max={999}
            allowDecimal
            decimalScale={1}
          />
          <NumberInput
            value={
              isIndividualMode
                ? keyPosition.height ?? 60
                : localHeight ?? keyPosition.height ?? 60
            }
            onChange={handleHeightChange}
            onBlur={onSizeBlur}
            prefix="H"
            min={1}
            max={999}
            allowDecimal
            decimalScale={1}
          />
        </PropertyRow>
      </PropertySection>

      {/* 외형 */}
      <PropertySection>
        {/* 배경색 */}
        <PropertyRow label={t('propertiesPanel.backgroundColor') || '배경색'}>
          <ColorSwatchButton
            ref={bgColorBtnRef}
            type="button"
            onClick={() => handlePickerToggle('backgroundColor')}
            open={pickerFor === 'backgroundColor'}
            className="w-[23px] h-[23px] rounded-md cursor-pointer transition-shadow flex-shrink-0"
            surfaceClassName="rounded-md"
            color={getDisplayColor(colorValueFor('backgroundColor'))}
          />
        </PropertyRow>

        {/* 테두리 색상 */}
        <PropertyRow label={t('propertiesPanel.borderColor') || '테두리 색상'}>
          <ColorSwatchButton
            ref={borderColorBtnRef}
            type="button"
            onClick={() => handlePickerToggle('borderColor')}
            open={pickerFor === 'borderColor'}
            className="w-[23px] h-[23px] rounded-md cursor-pointer transition-shadow flex-shrink-0"
            surfaceClassName="rounded-md"
            color={getDisplayColor(colorValueFor('borderColor'))}
          />
        </PropertyRow>

        {/* 테두리 두께 */}
        <PropertyRow label={t('propertiesPanel.borderWidth') || '테두리 두께'}>
          <NumberInput
            value={keyPosition.borderWidth ?? 3}
            onChange={(value) =>
              handleStyleChangeComplete('borderWidth', value)
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
          <NumberInput
            value={keyPosition.borderRadius ?? 10}
            onChange={(value) =>
              handleStyleChangeComplete('borderRadius', value)
            }
            suffix="px"
            min={0}
            max={100}
            allowDecimal
            decimalScale={1}
          />
        </PropertyRow>

        {/* 커스텀 이미지 - 단일 선택 모드에서만 표시 */}
        {onToggleImagePicker && imageButtonRef && (
          <PropertyRow
            label={t('propertiesPanel.customImage') || '커스텀 이미지'}
          >
            <button
              ref={imageButtonRef}
              type="button"
              className={`px-[8px] h-[23px] bg-fill hover:bg-fill-hover active:bg-fill-active transition-colors duration-fast rounded-md flex items-center justify-center ${
                showImagePicker ? 'shadow-focus-ring' : ''
              } text-fg text-body`}
              onClick={onToggleImagePicker}
            >
              {t('propertiesPanel.configure') || '설정하기'}
            </button>
          </PropertyRow>
        )}
      </PropertySection>

      {/* 텍스트·폰트 */}
      <PropertySection>
        {/* 표시 텍스트 */}
        {!hideDisplayText && (
          <PropertyRow
            label={t('propertiesPanel.displayText') || '표시 텍스트'}
          >
            <TextInput
              value={keyPosition.displayText || ''}
              onChange={handleDisplayTextChange}
              onBlur={handleDisplayTextBlur}
              placeholder={keyInfo?.displayName || ''}
              width="54px"
            />
          </PropertyRow>
        )}

        {/* 폰트 */}
        <PropertyRow label={t('propertiesPanel.font') || '폰트'}>
          <button
            type="button"
            className={`px-[8px] h-[23px] bg-fill hover:bg-fill-hover active:bg-fill-active transition-colors duration-fast rounded-md flex items-center justify-center ${
              activePageKey === FONT_PAGE_KEY ? 'shadow-focus-ring' : ''
            } text-fg text-body`}
            onClick={() => {
              setPickerFor(null);
              if (activePageKey === FONT_PAGE_KEY) closePage();
              else openPage(FONT_PAGE_KEY);
            }}
          >
            {t('propertiesPanel.configure') || '설정하기'}
          </button>
        </PropertyRow>

        {/* 글꼴 크기 */}
        <PropertyRow label={t('propertiesPanel.fontSize') || '글꼴 크기'}>
          <NumberInput
            value={keyPosition.fontSize ?? 14}
            onChange={(value) => handleStyleChangeComplete('fontSize', value)}
            suffix="px"
            min={8}
            max={72}
            allowDecimal
            decimalScale={1}
          />
        </PropertyRow>

        {/* 글꼴 색상 */}
        <PropertyRow label={t('propertiesPanel.fontColor') || '글꼴 색상'}>
          <ColorSwatchButton
            ref={fontColorBtnRef}
            type="button"
            onClick={() => handlePickerToggle('fontColor')}
            open={pickerFor === 'fontColor'}
            className="w-[23px] h-[23px] rounded-md cursor-pointer transition-shadow flex-shrink-0"
            surfaceClassName="rounded-md"
            color={getDisplayColor(colorValueFor('fontColor'))}
          />
        </PropertyRow>

        {/* 글꼴 스타일 */}
        <PropertyRow label={t('propertiesPanel.fontStyle') || '글꼴 스타일'}>
          <FontStyleToggle
            isBold={(keyPosition.fontWeight ?? 700) >= 700}
            isItalic={keyPosition.fontItalic ?? false}
            isUnderline={keyPosition.fontUnderline ?? false}
            isStrikethrough={keyPosition.fontStrikethrough ?? false}
            onBoldChange={(value) =>
              handleStyleChangeComplete('fontWeight', value ? 700 : 400)
            }
            onItalicChange={(value) =>
              handleStyleChangeComplete('fontItalic', value)
            }
            onUnderlineChange={(value) =>
              handleStyleChangeComplete('fontUnderline', value)
            }
            onStrikethroughChange={(value) =>
              handleStyleChangeComplete('fontStrikethrough', value)
            }
          />
        </PropertyRow>
      </PropertySection>

      {/* 커스텀 CSS 활성화 시에만 클래스명 및 CSS 우선순위 표시 */}
      {useCustomCSS && (
        <PropertySection>
          {/* CSS 우선순위 토글 */}
          <div className="flex justify-between items-center w-full min-h-[32px]">
            <p className="text-fg-muted text-label">
              {t('propertiesPanel.useInlineStyles') || '인라인 스타일 우선'}
            </p>
            <Checkbox
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
              placeholder="className"
              width="90px"
            />
          </PropertyRow>
        </PropertySection>
      )}

      {showSoundControls && (
        <PropertySection>
          <PropertyRow
            label={t('propertiesPanel.keySoundEnabled') || '키 사운드 활성화'}
          >
            <Checkbox
              checked={keyPosition.soundEnabled ?? false}
              onChange={() => {
                const nextEnabled = !(keyPosition.soundEnabled ?? false);
                onKeyPreview?.(keyIndex, { soundEnabled: nextEnabled });
                onKeyUpdate({ index: keyIndex, soundEnabled: nextEnabled });
              }}
            />
          </PropertyRow>

          <PropertyRow label={t('propertiesPanel.keySound') || '키 사운드'}>
            <button
              type="button"
              className={`px-[8px] h-[23px] bg-fill hover:bg-fill-hover active:bg-fill-active transition-colors duration-fast rounded-md flex items-center justify-center ${
                activePageKey === SOUND_PAGE_KEY ? 'shadow-focus-ring' : ''
              } text-fg text-body`}
              onClick={() => {
                setPickerFor(null);
                if (activePageKey === SOUND_PAGE_KEY) closePage();
                else openPage(SOUND_PAGE_KEY);
              }}
            >
              {t('propertiesPanel.configure') || '설정하기'}
            </button>
          </PropertyRow>

          <PropertyRow
            label={t('propertiesPanel.soundVolume') || '사운드 볼륨'}
          >
            <NumberInput
              value={keyPosition.soundVolume ?? 100}
              onChange={(value) =>
                handleStyleChangeComplete(
                  'soundVolume',
                  Math.max(0, Math.min(200, value)),
                )
              }
              suffix="%"
              min={0}
              max={200}
            />
          </PropertyRow>
        </PropertySection>
      )}

      {/* 이미지 픽커 팝업 - 단일 선택 모드에서만 */}
      {showImagePicker && onToggleImagePicker && imageButtonRef && (
        <ImagePicker
          open={showImagePicker}
          referenceRef={imageButtonRef}
          panelElement={panelElement}
          idleImage={keyPosition.inactiveImage || ''}
          activeImage={keyPosition.activeImage || ''}
          idleTransparent={keyPosition.idleTransparent ?? false}
          activeTransparent={keyPosition.activeTransparent ?? false}
          idleImageFit={
            keyPosition.idleImageFit ?? keyPosition.imageFit ?? 'cover'
          }
          activeImageFit={
            keyPosition.activeImageFit ?? keyPosition.imageFit ?? 'cover'
          }
          onIdleImageChange={handleIdleImageChange}
          onActiveImageChange={handleActiveImageChange}
          onIdleTransparentChange={handleIdleTransparentChange}
          onActiveTransparentChange={handleActiveTransparentChange}
          onIdleImageFitChange={handleIdleImageFitChange}
          onActiveImageFitChange={handleActiveImageFitChange}
          onIdleImageReset={handleIdleImageReset}
          onActiveImageReset={handleActiveImageReset}
          onClose={() => onToggleImagePicker()}
        />
      )}

      {/* 통합 ColorPicker - 단일 인스턴스로 깜빡임 없이 전환 */}
      {pickerFor && pickerFor !== 'image' && (
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
          color={colorValueFor(pickerFor as StyleColorTarget)}
          onColorChange={(c: string) =>
            handleColorChange(pickerFor as StyleColorTarget, c)
          }
          onColorChangeComplete={(c: string) =>
            handleColorChangeComplete(pickerFor as StyleColorTarget, c)
          }
          onClose={() => setPickerFor(null)}
          solidOnly={true}
          stateMode={colorState}
          onStateModeChange={setColorState}
          interactiveRefs={colorPickerInteractiveRefs}
        />
      )}

      {/* FontPicker — 패널 서브 페이지 */}
      {renderPageKey === FONT_PAGE_KEY &&
        pageHost &&
        createPortal(
          <FontPicker
            open
            selectedFont={keyPosition.fontFamily || null}
            onFontSelect={(fontName) => {
              handleStyleChangeComplete('fontFamily', fontName);
            }}
            pageTitle={t('propertiesPanel.font') || '폰트'}
            onBack={closePage}
          />,
          pageHost,
        )}

      {/* SoundPicker — 패널 서브 페이지 */}
      {showSoundControls &&
        renderPageKey === SOUND_PAGE_KEY &&
        pageHost &&
        createPortal(
          <SoundPicker
            open
            selectedSound={keyPosition.soundPath || null}
            onSoundSelect={(soundPath) => {
              const nextPath = soundPath || '';
              onKeyPreview?.(keyIndex, { soundPath: nextPath });
              onKeyUpdate({ index: keyIndex, soundPath: nextPath });
            }}
            previewVolume={keyPosition.soundVolume ?? 100}
            pageTitle={t('propertiesPanel.keySound') || '키 사운드'}
            onBack={closePage}
          />,
          pageHost,
        )}
    </>
  );
};

export default StyleTabContent;
