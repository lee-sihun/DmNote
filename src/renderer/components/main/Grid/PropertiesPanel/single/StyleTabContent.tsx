import React from 'react';
import type { StyleTabContentProps } from '../types';
import type { EditorElementPropertyPatchV1 } from '@src/types/editor';
import type { KeyPosition } from '@src/types/key/keys';
import {
  PropertyRow,
  PropertySection,
  TextInput,
} from '../controls/PropertyInputs';
import ColorPicker from '../../../Modal/content/pickers/color/ColorPicker';
import PopupExit from '@components/main/Modal/PopupExit';
import Checkbox from '../../../common/checkbox/Checkbox';
import { editGestureController } from '@src/renderer/editor/runtime/gesture/editGestureController';
import SoundSection from '../controls/SoundSection';
import SingleGeometrySection from './SingleGeometrySection';
import SingleTypographySection from './SingleTypographySection';
import SingleSurfaceSection from './SingleSurfaceSection';
import SingleMappingSection from './SingleMappingSection';
import SingleImagePickerPopup from './SingleImagePickerPopup';
import {
  useSingleStyleColorController,
  type SingleStyleColorTarget,
} from './useSingleStyleColorController';

// 인-패널 서브 페이지 키 — 트리거 사이트별 유니크
const SOUND_PAGE_KEY = 'single-style:sound';

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
  const {
    pickerFor,
    setPickerFor,
    effectiveColorState,
    setColorState,
    backgroundColorButtonRef: bgColorBtnRef,
    borderColorButtonRef: borderColorBtnRef,
    fontColorButtonRef: fontColorBtnRef,
    colorPickerInteractiveRefs,
    handlePickerToggle,
    resolveColorProperty,
    colorValueFor,
    handleColorChange,
    handleColorChangeComplete,
    gradientTarget,
    gradientSpecFor,
    gradientState,
    setLocalColors,
    getDisplayColor,
  } = useSingleStyleColorController({
    keyPosition,
    shadowActiveState,
    canvasAnchor,
    onPaintPreview,
    onPaintCommit,
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
                : colorValueFor(pickerFor as SingleStyleColorTarget)
            }
            onColorChange={(c: string) =>
              gradientTarget
                ? gradientState.handlePickerColorChange(c, false)
                : handleColorChange(pickerFor as SingleStyleColorTarget, c)
            }
            onColorChangeComplete={(c: string) =>
              gradientTarget
                ? gradientState.handlePickerColorChange(c, true)
                : handleColorChangeComplete(
                    pickerFor as SingleStyleColorTarget,
                    c,
                  )
            }
            onInputCancel={(_target, restoredColor) => {
              gradientState.cancelPreview();
              if (typeof restoredColor === 'string') {
                const prop = resolveColorProperty(
                  pickerFor as SingleStyleColorTarget,
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
