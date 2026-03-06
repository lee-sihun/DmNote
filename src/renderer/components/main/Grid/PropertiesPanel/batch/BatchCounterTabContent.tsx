import React, { useRef, useState } from 'react';
import type { KeyCounterSettings } from '@src/types/key/keys';
import {
  PropertyRow,
  NumberInput,
  FontStyleToggle,
  SectionDivider,
} from '../index';
import Checkbox from '@components/main/common/Checkbox';
import Dropdown from '@components/main/common/Dropdown';
import FontPicker from '@components/main/Modal/content/pickers/FontPicker';
import FontManagerModal from '@components/main/Modal/content/managers/FontManagerModal';
import CounterAnimationPicker from '@components/main/Modal/content/pickers/CounterAnimationPicker';

interface BatchKeyVisual {
  width?: number;
  height?: number;
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: number;
  fontColor?: string;
  fontSize?: number;
  fontWeight?: number;
  fontFamily?: string;
  fontItalic?: boolean;
  fontUnderline?: boolean;
  fontStrikethrough?: boolean;
  displayText?: string;
  displayName?: string;
  className?: string;
  activeBackgroundColor?: string;
  activeBorderColor?: string;
  activeFontColor?: string;
  useInlineStyles?: boolean;
  isStat?: boolean;
}

interface BatchCounterTabContentProps {
  // 카운터 설정 (첫 번째 선택 키 기준)
  batchCounterSettings: KeyCounterSettings;
  // 첫 번째 선택 키의 시각 정보 (프리뷰용)
  keyVisual?: BatchKeyVisual;
  // 핸들러
  handleBatchCounterUpdate: (updates: Partial<KeyCounterSettings>) => void;
  // 컬러 디스플레이 (현재 상태 기준)
  colorState: 'idle' | 'active';
  getCounterColorDisplay: (target: 'fill' | 'stroke') => string;
  // 컬러 피커 토글
  onFillPickerToggle: () => void;
  onStrokePickerToggle: () => void;
  // ref 목록
  batchCounterFillButtonRef: React.RefObject<HTMLButtonElement>;
  batchCounterStrokeButtonRef: React.RefObject<HTMLButtonElement>;
  isFillPickerOpen: boolean;
  isStrokePickerOpen: boolean;
  // 패널 요소 (FloatingPopup 위치용)
  panelElement: HTMLElement | null;
  // 번역
  t: (key: string) => string;
}

const BatchCounterTabContent: React.FC<BatchCounterTabContentProps> = ({
  batchCounterSettings,
  keyVisual,
  handleBatchCounterUpdate,
  colorState,
  getCounterColorDisplay,
  onFillPickerToggle,
  onStrokePickerToggle,
  batchCounterFillButtonRef,
  batchCounterStrokeButtonRef,
  isFillPickerOpen,
  isStrokePickerOpen,
  panelElement,
  t,
}) => {
  const fontButtonRef = useRef<HTMLButtonElement>(null);
  const animationButtonRef = useRef<HTMLButtonElement>(null);
  const [showFontPicker, setShowFontPicker] = useState(false);
  const [showFontManager, setShowFontManager] = useState(false);
  const [showAnimationPicker, setShowAnimationPicker] = useState(false);

  const handleAnimationUpdate = (
    nextAnimation: KeyCounterSettings['animation'],
  ) => {
    handleBatchCounterUpdate({ animation: nextAnimation });
  };

  const getDisplayColor = (color: string): string => {
    if (!color) return '#ffffff';
    if (color.startsWith('rgba') || color.startsWith('rgb')) return color;
    if (color.startsWith('#')) return color;
    return '#ffffff';
  };

  return (
    <>
      {/* 카운터 사용 */}
      <div className="flex justify-between items-center w-full h-[23px]">
        <p className="text-white text-style-2">
          {t('counterSetting.counterEnabled') || '카운터 표시'}
        </p>
        <Checkbox
          checked={batchCounterSettings.enabled}
          onChange={() =>
            handleBatchCounterUpdate({
              enabled: !batchCounterSettings.enabled,
            })
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
          value={batchCounterSettings.placement}
          onChange={(value) =>
            handleBatchCounterUpdate({
              placement: value as 'inside' | 'outside',
            })
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
            {
              label: t('counterSetting.alignRight') || '우측',
              value: 'right',
            },
          ]}
          value={batchCounterSettings.align}
          onChange={(value) =>
            handleBatchCounterUpdate({
              align: value as 'top' | 'bottom' | 'left' | 'right',
            })
          }
        />
      </PropertyRow>

      {/* 정렬 방식 (내부 배치 전용) */}
      {batchCounterSettings.placement === 'inside' && (
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
            value={batchCounterSettings.alignMode ?? 'center'}
            onChange={(value) =>
              handleBatchCounterUpdate({
                alignMode: value as 'center' | 'between',
              })
            }
          />
        </PropertyRow>
      )}

      {/* 간격 */}
      <PropertyRow label={t('counterSetting.gap') || '간격'}>
        <NumberInput
          value={batchCounterSettings.gap}
          onChange={(value) => handleBatchCounterUpdate({ gap: value })}
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
          ref={batchCounterFillButtonRef}
          type="button"
          onClick={onFillPickerToggle}
          className={`w-[23px] h-[23px] rounded-[7px] border-[1px] overflow-hidden cursor-pointer transition-colors flex-shrink-0 ${
            isFillPickerOpen
              ? 'border-[#459BF8]'
              : 'border-[#3A3943] hover:border-[#505058]'
          }`}
          style={{
            backgroundColor: getDisplayColor(getCounterColorDisplay('fill')),
          }}
          title={`${t('counterSetting.fill') || '채우기'} (${
            colorState === 'active'
              ? t('counterSetting.active') || '입력'
              : t('counterSetting.idle') || '대기'
          })`}
        />
      </PropertyRow>

      {/* 외곽선 색상 */}
      <PropertyRow label={t('counterSetting.stroke') || '외곽선'}>
        <button
          ref={batchCounterStrokeButtonRef}
          type="button"
          onClick={onStrokePickerToggle}
          className={`w-[23px] h-[23px] rounded-[7px] border-[1px] overflow-hidden cursor-pointer transition-colors flex-shrink-0 ${
            isStrokePickerOpen
              ? 'border-[#459BF8]'
              : 'border-[#3A3943] hover:border-[#505058]'
          }`}
          style={{
            backgroundColor: getDisplayColor(getCounterColorDisplay('stroke')),
          }}
          title={`${t('counterSetting.stroke') || '외곽선'} (${
            colorState === 'active'
              ? t('counterSetting.active') || '입력'
              : t('counterSetting.idle') || '대기'
          })`}
        />
      </PropertyRow>

      <SectionDivider />

      {/* 폰트 */}
      <PropertyRow label={t('counterSetting.font') || '폰트'}>
        <button
          ref={fontButtonRef}
          type="button"
          className={`px-[7px] h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] flex items-center justify-center ${
            showFontPicker ? 'border-[#459BF8]' : 'border-[#3A3943]'
          } text-[#DBDEE8] text-style-4`}
          onClick={() => setShowFontPicker((prev) => !prev)}
        >
          {t('propertiesPanel.configure') || '설정하기'}
        </button>
      </PropertyRow>

      {/* 폰트 크기 */}
      <PropertyRow label={t('counterSetting.fontSize') || '폰트 크기'}>
        <NumberInput
          value={batchCounterSettings.fontSize ?? 16}
          onChange={(value) => handleBatchCounterUpdate({ fontSize: value })}
          suffix="px"
          min={8}
          max={72}
          width="54px"
        />
      </PropertyRow>

      {/* 폰트 스타일 */}
      <PropertyRow label={t('counterSetting.fontStyle') || '폰트 스타일'}>
        <FontStyleToggle
          isBold={(batchCounterSettings.fontWeight ?? 400) >= 700}
          isItalic={batchCounterSettings.fontItalic ?? false}
          isUnderline={batchCounterSettings.fontUnderline ?? false}
          isStrikethrough={batchCounterSettings.fontStrikethrough ?? false}
          onBoldChange={(value) =>
            handleBatchCounterUpdate({ fontWeight: value ? 700 : 400 })
          }
          onItalicChange={(value) =>
            handleBatchCounterUpdate({ fontItalic: value })
          }
          onUnderlineChange={(value) =>
            handleBatchCounterUpdate({ fontUnderline: value })
          }
          onStrikethroughChange={(value) =>
            handleBatchCounterUpdate({ fontStrikethrough: value })
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
          checked={batchCounterSettings.animation.enabled}
          onChange={() =>
            handleBatchCounterUpdate({
              animation: {
                ...batchCounterSettings.animation,
                enabled: !batchCounterSettings.animation.enabled,
              },
            })
          }
        />
      </div>

      <PropertyRow label={t('counterSetting.animation') || '애니메이션 설정'}>
        <button
          ref={animationButtonRef}
          type="button"
          className={`px-[7px] h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] flex items-center justify-center ${
            showAnimationPicker ? 'border-[#459BF8]' : 'border-[#3A3943]'
          } text-[#DBDEE8] text-style-4`}
          onClick={() => setShowAnimationPicker((prev) => !prev)}
        >
          {t('propertiesPanel.configure') || '설정하기'}
        </button>
      </PropertyRow>

      {/* FontPicker */}
      {showFontPicker && (
        <FontPicker
          open={true}
          referenceRef={fontButtonRef}
          panelElement={panelElement}
          selectedFont={batchCounterSettings.fontFamily || null}
          onFontSelect={(fontFamily) => {
            handleBatchCounterUpdate({ fontFamily });
          }}
          onClose={() => setShowFontPicker(false)}
          onOpenManager={() => {
            setShowFontManager(true);
          }}
          interactiveRefs={[fontButtonRef]}
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
          referenceRef={animationButtonRef}
          panelElement={panelElement}
          animation={batchCounterSettings.animation}
          counterSettings={batchCounterSettings}
          keyVisual={keyVisual}
          onAnimationChange={handleAnimationUpdate}
          onClose={() => setShowAnimationPicker(false)}
          t={t}
          interactiveRefs={[animationButtonRef]}
        />
      )}
    </>
  );
};

export default BatchCounterTabContent;
