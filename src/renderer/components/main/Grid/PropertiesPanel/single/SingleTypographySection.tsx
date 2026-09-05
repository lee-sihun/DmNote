import React from 'react';
import { createPortal } from 'react-dom';
import type { KeyPosition } from '@src/types/key/keys';
import { useFontStore } from '@stores/useFontStore';
import { editGestureController } from '@src/renderer/editor/runtime/gesture/editGestureController';
import { resolveSupportedFontWeight } from '@utils/typography/fontWeights';
import {
  DEFAULT_ELEMENT_BASE_FONT_WEIGHT,
  DEFAULT_ELEMENT_FONT_BOLD,
} from '@utils/element/elementDefaults';
import FontPicker from '@components/main/Modal/content/pickers/font/FontPicker';
import FontPickerOpenButton from '@components/main/Modal/content/pickers/font/FontPickerOpenButton';
import { ColorSwatchButton } from '@components/main/Modal/content/pickers/color/ColorSwatch';
import {
  FontStyleToggle,
  NumberInput,
  PropertyRow,
  PropertySection,
  TextInput,
} from '../controls/PropertyInputs';
import FontWeightDropdown from '../controls/FontWeightDropdown';
import { createFontStyleToggleHandlers } from '../selection/fontStyleToggleHandlers';
import { usePanelNav } from '../navigation/PanelNavContext';

const FONT_PAGE_KEY = 'single-style:font';

interface SingleTypographySectionProps {
  keyPosition: KeyPosition;
  keyInfo: { globalKey: string; displayName: string } | null;
  hideDisplayText: boolean;
  fontColorButtonRef: React.RefObject<HTMLButtonElement | null>;
  fontColorOpen: boolean;
  fontColor: string;
  onFontColorToggle: () => void;
  onBeforeFontOpen: () => void;
  onDisplayTextPreview: (value: string) => void;
  onDisplayTextCommit: (value: string) => void;
  onStylePreview: (
    property: keyof KeyPosition,
    value: KeyPosition[keyof KeyPosition],
  ) => void;
  onStyleCommit: (
    property: keyof KeyPosition,
    value: KeyPosition[keyof KeyPosition],
    options?: { gestureId?: string },
  ) => void;
  t: (key: string) => string;
}

const SingleTypographySection = ({
  keyPosition,
  keyInfo,
  hideDisplayText,
  fontColorButtonRef,
  fontColorOpen,
  fontColor,
  onFontColorToggle,
  onBeforeFontOpen,
  onDisplayTextPreview,
  onDisplayTextCommit,
  onStylePreview,
  onStyleCommit,
  t,
}: SingleTypographySectionProps) => {
  const { activePageKey, renderPageKey, openPage, closePage, pageHost } =
    usePanelNav();

  return (
    <>
      <PropertySection>
        {!hideDisplayText && (
          <PropertyRow
            label={t('propertiesPanel.displayText') || '표시 텍스트'}
          >
            <TextInput
              value={keyPosition.displayText || ''}
              onChange={onDisplayTextPreview}
              onBlur={onDisplayTextCommit}
              onCancel={() => editGestureController.cancel()}
              placeholder={keyInfo?.displayName || ''}
              width="54px"
            />
          </PropertyRow>
        )}

        <PropertyRow label={t('propertiesPanel.font') || '폰트'}>
          <FontPickerOpenButton
            activePageKey={activePageKey}
            pageKey={FONT_PAGE_KEY}
            onBeforeOpen={onBeforeFontOpen}
            onOpen={() => openPage(FONT_PAGE_KEY)}
            onClose={closePage}
          >
            {t('propertiesPanel.configure') || '설정하기'}
          </FontPickerOpenButton>
        </PropertyRow>

        <PropertyRow label={t('propertiesPanel.fontSize') || '글꼴 크기'}>
          <NumberInput
            value={keyPosition.fontSize ?? 14}
            onChange={(value) => onStyleCommit('fontSize', value)}
            onPreview={(value) => onStylePreview('fontSize', value)}
            onCancel={() => editGestureController.cancel()}
            suffix="px"
            min={8}
            max={72}
            allowDecimal
            decimalScale={1}
          />
        </PropertyRow>

        <PropertyRow label={t('propertiesPanel.fontWeight') || '글꼴 굵기'}>
          <FontWeightDropdown
            fontFamilies={[keyPosition.fontFamily]}
            value={keyPosition.fontWeight ?? DEFAULT_ELEMENT_BASE_FONT_WEIGHT}
            onChange={(value) => onStyleCommit('fontWeight', value)}
          />
        </PropertyRow>

        <PropertyRow label={t('propertiesPanel.fontColor') || '글꼴 색상'}>
          <ColorSwatchButton
            ref={fontColorButtonRef}
            type="button"
            onClick={onFontColorToggle}
            open={fontColorOpen}
            className="w-[23px] h-[23px] rounded-md cursor-pointer transition-shadow flex-shrink-0"
            surfaceClassName="rounded-md"
            color={fontColor}
          />
        </PropertyRow>

        <PropertyRow label={t('propertiesPanel.fontStyle') || '글꼴 스타일'}>
          <FontStyleToggle
            isBold={
              keyPosition.fontBold ??
              (keyPosition.fontWeight == null
                ? DEFAULT_ELEMENT_FONT_BOLD
                : keyPosition.fontWeight === 700)
            }
            isItalic={keyPosition.fontItalic ?? false}
            isUnderline={keyPosition.fontUnderline ?? false}
            isStrikethrough={keyPosition.fontStrikethrough ?? false}
            {...createFontStyleToggleHandlers(onStyleCommit)}
          />
        </PropertyRow>
      </PropertySection>

      {renderPageKey === FONT_PAGE_KEY &&
        pageHost &&
        createPortal(
          <FontPicker
            open
            selectedFont={keyPosition.fontFamily || null}
            onFontSelect={(fontName) => {
              if (fontName === null) return;
              const currentWeight =
                keyPosition.fontWeight ?? DEFAULT_ELEMENT_BASE_FONT_WEIGHT;
              const nextWeight = resolveSupportedFontWeight(
                fontName,
                useFontStore.getState().getAllFonts(),
              );
              // 굵기 재선택은 폰트 변경과 한 undo 단계 - 따로 되돌리면 새 폰트에
              // 지원하지 않는 굵기가 남는다
              const gestureId = crypto.randomUUID();
              onStyleCommit('fontFamily', fontName, { gestureId });
              if (nextWeight !== currentWeight) {
                onStyleCommit('fontWeight', nextWeight, { gestureId });
              }
            }}
            pageTitle={t('propertiesPanel.font') || '폰트'}
            onBack={closePage}
          />,
          pageHost,
        )}
    </>
  );
};

export default SingleTypographySection;
