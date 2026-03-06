/* eslint-disable react-hooks/set-state-in-effect */
import React, { useEffect, useRef, useState } from 'react';
import type { CounterTabContentProps } from '../types';
import type {
  KeyCounterAnimationSettings,
  KeyCounterSettings,
} from '@src/types/key/keys';
import { normalizeCounterSettings } from '@src/types/key/keys';
import {
  PropertyRow,
  FontStyleToggle,
  NumberInput,
  SectionDivider,
} from '../PropertyInputs';
import Checkbox from '@components/main/common/Checkbox';
import Dropdown from '@components/main/common/Dropdown';
import ColorPicker from '@components/main/Modal/content/pickers/ColorPicker';
import FontPicker from '@components/main/Modal/content/pickers/FontPicker';
import FontManagerModal from '@components/main/Modal/content/managers/FontManagerModal';
import CounterAnimationPicker from '@components/main/Modal/content/pickers/CounterAnimationPicker';

type PickerTarget = 'fill' | 'stroke' | 'font' | null;
type ColorState = 'idle' | 'active';

const CounterTabContent: React.FC<CounterTabContentProps> = ({
  keyIndex,
  keyPosition,
  keyDisplayName,
  isStat,
  onKeyUpdate,
  panelElement,
  t,
}) => {
  const fillBtnRef = useRef<HTMLButtonElement>(null);
  const strokeBtnRef = useRef<HTMLButtonElement>(null);
  const fontBtnRef = useRef<HTMLButtonElement>(null);
  const animationBtnRef = useRef<HTMLButtonElement>(null);

  const [pickerFor, setPickerFor] = useState<PickerTarget>(null);
  const pickerOpen = pickerFor !== null && pickerFor !== 'font';
  const [colorState, setColorState] = useState<ColorState>('idle');
  const [showFontManager, setShowFontManager] = useState(false);
  const [showAnimationPicker, setShowAnimationPicker] = useState(false);

  const counterSettings = normalizeCounterSettings(keyPosition.counter);

  // 로컬 색상 상태 (드래그 중 UI 업데이트용)
  const [localColors, setLocalColors] = useState({
    fillIdle: counterSettings.fill.idle,
    fillActive: counterSettings.fill.active,
    strokeIdle: counterSettings.stroke.idle,
    strokeActive: counterSettings.stroke.active,
  });

  // 피커가 닫혀있을 때만 외부 prop과 동기화
  useEffect(() => {
    if (!pickerOpen) {
      setLocalColors({
        fillIdle: counterSettings.fill.idle,
        fillActive: counterSettings.fill.active,
        strokeIdle: counterSettings.stroke.idle,
        strokeActive: counterSettings.stroke.active,
      });
    }
  }, [
    pickerOpen,
    counterSettings.fill.idle,
    counterSettings.fill.active,
    counterSettings.stroke.idle,
    counterSettings.stroke.active,
  ]);

  const colorPickerInteractiveRefs = [fillBtnRef, strokeBtnRef];

  const handleCounterUpdate = (updates: Partial<KeyCounterSettings>) => {
    const currentSettings = normalizeCounterSettings(keyPosition.counter);
    const newSettings = { ...currentSettings, ...updates };
    onKeyUpdate({ index: keyIndex, counter: newSettings });
  };

  const handleAnimationUpdate = (
    nextAnimation: KeyCounterAnimationSettings,
  ) => {
    handleCounterUpdate({ animation: nextAnimation });
  };

  const handlePickerToggle = (target: Exclude<PickerTarget, null>) => {
    setPickerFor((prev) => (prev === target ? null : target));
  };

  const getDisplayColor = (color: string): string => {
    if (!color) return '#ffffff';
    if (color.startsWith('rgba') || color.startsWith('rgb')) return color;
    if (color.startsWith('#')) return color;
    return '#ffffff';
  };

  const activeColorFor = (
    target: Exclude<PickerTarget, null>,
    state: ColorState,
  ): string => {
    if (target === 'fill') {
      return state === 'active' ? localColors.fillActive : localColors.fillIdle;
    }
    return state === 'active'
      ? localColors.strokeActive
      : localColors.strokeIdle;
  };

  // 드래그 중 로컬 상태만 업데이트 (부모에게 전달 안함)
  const handleColorChange = (color: string) => {
    if (!pickerFor) return;
    const key =
      pickerFor === 'fill'
        ? colorState === 'active'
          ? 'fillActive'
          : 'fillIdle'
        : colorState === 'active'
        ? 'strokeActive'
        : 'strokeIdle';

    setLocalColors((prev) => ({ ...prev, [key]: color }));
  };

  // 드래그 완료 시 부모에게 전달
  const handleColorChangeComplete = (color: string) => {
    if (!pickerFor) return;

    const key =
      pickerFor === 'fill'
        ? colorState === 'active'
          ? 'fillActive'
          : 'fillIdle'
        : colorState === 'active'
        ? 'strokeActive'
        : 'strokeIdle';

    setLocalColors((prev) => ({ ...prev, [key]: color }));

    if (pickerFor === 'fill') {
      if (colorState === 'active') {
        handleCounterUpdate({
          fill: { ...counterSettings.fill, active: color },
        });
      } else {
        handleCounterUpdate({
          fill: { ...counterSettings.fill, idle: color },
        });
      }
      return;
    }

    if (colorState === 'active') {
      handleCounterUpdate({
        stroke: { ...counterSettings.stroke, active: color },
      });
    } else {
      handleCounterUpdate({
        stroke: { ...counterSettings.stroke, idle: color },
      });
    }
  };

  return (
    <>
      {/* 카운터 사용 */}
      <div className="flex justify-between items-center w-full h-[23px]">
        <p className="text-white text-style-2">
          {t('counterSetting.counterEnabled') || '카운터 표시'}
        </p>
        <Checkbox
          checked={counterSettings.enabled}
          onChange={() =>
            handleCounterUpdate({ enabled: !counterSettings.enabled })
          }
        />
      </div>

      <SectionDivider />

      {/* 배치 영역 */}
      <PropertyRow label={t('counterSetting.placementArea') || '배치 영역'}>
        <Dropdown
          options={[
            {
              label: t('counterSetting.placementInside') || '내부',
              value: 'inside',
            },
            {
              label: t('counterSetting.placementOutside') || '외부',
              value: 'outside',
            },
          ]}
          value={counterSettings.placement}
          onChange={(value) =>
            handleCounterUpdate({ placement: value as 'inside' | 'outside' })
          }
        />
      </PropertyRow>

      {/* 정렬 방향 */}
      <PropertyRow label={t('counterSetting.alignDirection') || '정렬 방향'}>
        <Dropdown
          options={[
            { label: t('counterSetting.alignTop') || '상단', value: 'top' },
            {
              label: t('counterSetting.alignBottom') || '하단',
              value: 'bottom',
            },
            { label: t('counterSetting.alignLeft') || '좌측', value: 'left' },
            { label: t('counterSetting.alignRight') || '우측', value: 'right' },
          ]}
          value={counterSettings.align}
          onChange={(value) =>
            handleCounterUpdate({
              align: value as 'top' | 'bottom' | 'left' | 'right',
            })
          }
        />
      </PropertyRow>

      {/* 정렬 방식 (내부 배치 전용) */}
      {counterSettings.placement === 'inside' && (
        <PropertyRow label={t('counterSetting.alignMode') || '정렬 방식'}>
          <Dropdown
            options={[
              {
                label: t('counterSetting.alignModeCenter') || '가운데',
                value: 'center',
              },
              {
                label: t('counterSetting.alignModeBetween') || '양끝',
                value: 'between',
              },
            ]}
            value={counterSettings.alignMode ?? 'center'}
            onChange={(value) =>
              handleCounterUpdate({
                alignMode: value as 'center' | 'between',
              })
            }
          />
        </PropertyRow>
      )}

      {/* 간격 */}
      <PropertyRow label={t('counterSetting.gap') || '간격'}>
        <NumberInput
          value={counterSettings.gap}
          onChange={(value) => handleCounterUpdate({ gap: value })}
          suffix="px"
          min={0}
          max={9999}
          width="54px"
        />
      </PropertyRow>

      <SectionDivider />

      {/* 채우기 색상 */}
      <PropertyRow label={t('counterSetting.fill') || '채우기'}>
        <button
          ref={fillBtnRef}
          type="button"
          onClick={() => handlePickerToggle('fill')}
          className={`w-[23px] h-[23px] rounded-[7px] border-[1px] overflow-hidden cursor-pointer transition-colors flex-shrink-0 ${
            pickerFor === 'fill'
              ? 'border-[#459BF8]'
              : 'border-[#3A3943] hover:border-[#505058]'
          }`}
          style={{
            backgroundColor: getDisplayColor(
              activeColorFor('fill', colorState),
            ),
          }}
        />
      </PropertyRow>

      {/* 외곽선 색상 */}
      <PropertyRow label={t('counterSetting.stroke') || '외곽선'}>
        <button
          ref={strokeBtnRef}
          type="button"
          onClick={() => handlePickerToggle('stroke')}
          className={`w-[23px] h-[23px] rounded-[7px] border-[1px] overflow-hidden cursor-pointer transition-colors flex-shrink-0 ${
            pickerFor === 'stroke'
              ? 'border-[#459BF8]'
              : 'border-[#3A3943] hover:border-[#505058]'
          }`}
          style={{
            backgroundColor: getDisplayColor(
              activeColorFor('stroke', colorState),
            ),
          }}
        />
      </PropertyRow>

      <SectionDivider />

      {/* 폰트 */}
      <PropertyRow label={t('counterSetting.font') || '폰트'}>
        <button
          ref={fontBtnRef}
          type="button"
          className={`px-[7px] h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] flex items-center justify-center ${
            pickerFor === 'font' ? 'border-[#459BF8]' : 'border-[#3A3943]'
          } text-[#DBDEE8] text-style-4`}
          onClick={() => handlePickerToggle('font')}
        >
          {t('propertiesPanel.configure') || '설정하기'}
        </button>
      </PropertyRow>

      {/* 폰트 크기 */}
      <PropertyRow label={t('counterSetting.fontSize') || '폰트 크기'}>
        <NumberInput
          value={counterSettings.fontSize ?? 16}
          onChange={(value) => handleCounterUpdate({ fontSize: value })}
          suffix="px"
          min={8}
          max={72}
          width="54px"
        />
      </PropertyRow>

      {/* 폰트 스타일 */}
      <PropertyRow label={t('counterSetting.fontStyle') || '폰트 스타일'}>
        <FontStyleToggle
          isBold={(counterSettings.fontWeight ?? 400) >= 700}
          isItalic={counterSettings.fontItalic ?? false}
          isUnderline={counterSettings.fontUnderline ?? false}
          isStrikethrough={counterSettings.fontStrikethrough ?? false}
          onBoldChange={(value) =>
            handleCounterUpdate({ fontWeight: value ? 700 : 400 })
          }
          onItalicChange={(value) => handleCounterUpdate({ fontItalic: value })}
          onUnderlineChange={(value) =>
            handleCounterUpdate({ fontUnderline: value })
          }
          onStrikethroughChange={(value) =>
            handleCounterUpdate({ fontStrikethrough: value })
          }
        />
      </PropertyRow>

      <SectionDivider />

      {/* 카운터 애니메이션 */}
      <div className="flex justify-between items-center w-full h-[23px]">
        <p className="text-white text-style-2">
          {t('counterSetting.animationEnabled') || '카운터 애니메이션'}
        </p>
        <Checkbox
          checked={counterSettings.animation.enabled}
          onChange={() =>
            handleCounterUpdate({
              animation: {
                ...counterSettings.animation,
                enabled: !counterSettings.animation.enabled,
              },
            })
          }
        />
      </div>

      <PropertyRow label={t('counterSetting.animation') || '애니메이션 설정'}>
        <button
          ref={animationBtnRef}
          type="button"
          className={`px-[7px] h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] flex items-center justify-center ${
            showAnimationPicker ? 'border-[#459BF8]' : 'border-[#3A3943]'
          } text-[#DBDEE8] text-style-4`}
          onClick={() => setShowAnimationPicker((prev) => !prev)}
        >
          {t('propertiesPanel.configure') || '설정하기'}
        </button>
      </PropertyRow>

      {pickerFor && pickerFor !== 'font' && (
        <ColorPicker
          open={pickerOpen}
          referenceRef={pickerFor === 'fill' ? fillBtnRef : strokeBtnRef}
          panelElement={panelElement}
          color={activeColorFor(pickerFor as 'fill' | 'stroke', colorState)}
          onColorChange={(c: string) => handleColorChange(c)}
          onColorChangeComplete={(c: string) => handleColorChangeComplete(c)}
          onClose={() => setPickerFor(null)}
          solidOnly={true}
          interactiveRefs={colorPickerInteractiveRefs}
          stateMode={colorState}
          onStateModeChange={(mode: string) =>
            setColorState(mode as ColorState)
          }
        />
      )}

      {/* FontPicker */}
      {pickerFor === 'font' && (
        <FontPicker
          open={true}
          referenceRef={fontBtnRef}
          panelElement={panelElement}
          selectedFont={counterSettings.fontFamily || null}
          onFontSelect={(fontName) => {
            handleCounterUpdate({ fontFamily: fontName });
          }}
          onClose={() => setPickerFor(null)}
          onOpenManager={() => {
            setShowFontManager(true);
          }}
          interactiveRefs={[fontBtnRef]}
        />
      )}

      {/* FontManagerModal */}
      {showFontManager && (
        <FontManagerModal
          isOpen={showFontManager}
          onClose={() => setShowFontManager(false)}
          t={t}
        />
      )}

      {showAnimationPicker && (
        <CounterAnimationPicker
          open={showAnimationPicker}
          referenceRef={animationBtnRef}
          panelElement={panelElement}
          animation={counterSettings.animation}
          counterSettings={counterSettings}
          keyVisual={{
            width: keyPosition.width,
            height: keyPosition.height,
            backgroundColor: keyPosition.backgroundColor,
            borderColor: keyPosition.borderColor,
            borderWidth: keyPosition.borderWidth,
            borderRadius: keyPosition.borderRadius,
            fontColor: keyPosition.fontColor,
            fontSize: keyPosition.fontSize,
            fontWeight: keyPosition.fontWeight,
            fontFamily: keyPosition.fontFamily,
            fontItalic: keyPosition.fontItalic,
            fontUnderline: keyPosition.fontUnderline,
            fontStrikethrough: keyPosition.fontStrikethrough,
            displayText: keyPosition.displayText,
            displayName: keyDisplayName,
            className: keyPosition.className,
            activeBackgroundColor: keyPosition.activeBackgroundColor,
            activeBorderColor: keyPosition.activeBorderColor,
            activeFontColor: keyPosition.activeFontColor,
            useInlineStyles: keyPosition.useInlineStyles,
            isStat,
          }}
          onAnimationChange={handleAnimationUpdate}
          onClose={() => setShowAnimationPicker(false)}
          t={t}
          interactiveRefs={[animationBtnRef]}
        />
      )}
    </>
  );
};

export default CounterTabContent;
