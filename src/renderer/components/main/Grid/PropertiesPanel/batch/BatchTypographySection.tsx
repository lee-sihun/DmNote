import { createPortal } from 'react-dom';
import FontPicker from '@components/main/Modal/content/pickers/font/FontPicker';
import FontPickerOpenButton from '@components/main/Modal/content/pickers/font/FontPickerOpenButton';
import { useFontStore } from '@stores/useFontStore';
import { editGestureController } from '@src/renderer/editor/runtime/gesture/editGestureController';
import { paintDescriptor, resolveStatePair } from '@src/types/color';
import type {
  EditorPaintPropertyPatchV1,
  EditorPreviewStylePropertyPatchV1,
  EditorStylePropertyPreviewPatchV1,
} from '@src/types/editor';
import type { KeyPosition } from '@src/types/key/keys';
import { parseAlphaPercent, toRgbHexColor } from '@utils/color/colorUtils';
import {
  DEFAULT_ELEMENT_ACTIVE_FONT,
  DEFAULT_ELEMENT_BASE_FONT_WEIGHT,
  DEFAULT_ELEMENT_FONT,
  DEFAULT_ELEMENT_FONT_BOLD,
} from '@utils/element/elementDefaults';
import { resolveSupportedFontWeight } from '@utils/typography/fontWeights';
import { aggregateMixedValue } from '@utils/core/mixedValue';
import {
  ColorInput,
  FontStyleToggle,
  NumberInput,
  PropertyRow,
  PropertySection,
  TextInput,
  createFontStyleToggleHandlers,
} from '../index';
import FontWeightDropdown from '../controls/FontWeightDropdown';
import { usePanelNav } from '../navigation/PanelNavContext';
import type { BatchElementPropertyUpdate } from '../types';

const FONT_PAGE_KEY = 'batch-style:font';

export interface BatchTypographyKeyData {
  index: number;
  position: KeyPosition | undefined;
  keyCode: string | null;
  keyInfo: { globalKey: string; displayName: string } | null;
}

type MixedValueGetter = <T>(
  getter: (position: KeyPosition) => T | undefined,
  defaultValue: T,
) => { isMixed: boolean; value: T };

interface BatchTypographySectionProps {
  hideDisplayText: boolean;
  hideFontControls: boolean;
  getMixedValue: MixedValueGetter;
  getActiveMixedValue: MixedValueGetter;
  getSelectedKeysData: () => BatchTypographyKeyData[];
  effectiveColorState: 'idle' | 'active';
  showActiveState: boolean;
  onColorStateChange: (state: 'idle' | 'active') => void;
  batchSelectionKey: string;
  onStylePropertyPreview?: (patch: EditorStylePropertyPreviewPatchV1) => void;
  onStylePropertyCommit?: (patch: EditorPreviewStylePropertyPatchV1) => void;
  onFontColorPreview?: (patch: EditorPaintPropertyPatchV1) => void;
  onFontColorCommit?: (patch: EditorPaintPropertyPatchV1) => void;
  onElementPropertyCommit?: (
    updates: BatchElementPropertyUpdate,
    options?: { gestureId?: string },
  ) => void;
  panelElement: HTMLElement | null;
  t: (key: string) => string;
}

const BatchTypographySection = ({
  hideDisplayText,
  hideFontControls,
  getMixedValue,
  getActiveMixedValue,
  getSelectedKeysData,
  effectiveColorState,
  showActiveState,
  onColorStateChange,
  batchSelectionKey,
  onStylePropertyPreview,
  onStylePropertyCommit,
  onFontColorPreview,
  onFontColorCommit,
  onElementPropertyCommit,
  panelElement,
  t,
}: BatchTypographySectionProps) => {
  const { activePageKey, renderPageKey, openPage, closePage, pageHost } =
    usePanelNav();

  const fontColorPairFor = (position: KeyPosition, active: boolean) =>
    resolveStatePair(
      active,
      { color: position.fontColor, gradient: position.fontGradient },
      {
        color: position.activeFontColor,
        gradient: position.activeFontGradient,
      },
    );
  const fontColorFor = (position: KeyPosition, active: boolean) =>
    fontColorPairFor(position, active).color?.trim() || undefined;
  const mixedFontColorParts = (
    getColor: (position: KeyPosition) => string | undefined,
    fallback: string,
  ) => {
    const mixedValue =
      effectiveColorState === 'active' ? getActiveMixedValue : getMixedValue;
    return {
      hexMixed: mixedValue(
        (position) => toRgbHexColor(getColor(position) ?? fallback),
        '',
      ).isMixed,
      alphaMixed: mixedValue(
        (position) => parseAlphaPercent(getColor(position) ?? fallback),
        100,
      ).isMixed,
    };
  };
  const getDisplayTextMixed = (): { isMixed: boolean; value: string } =>
    aggregateMixedValue(
      getSelectedKeysData(),
      (data) => data.position?.displayText || data.keyInfo?.displayName || '',
      '',
    );

  return (
    <>
      <PropertySection>
        {!hideDisplayText && (
          <PropertyRow
            label={t('propertiesPanel.displayText') || '표시 텍스트'}
          >
            {(() => {
              const { isMixed, value } = getDisplayTextMixed();
              const displayTextValue = getMixedValue(
                (pos) => pos.displayText,
                '',
              ).value;
              // displayText 직접 설정값 우선, 미설정 시 기본 표시명을 placeholder로 사용
              return (
                <TextInput
                  value={isMixed ? '' : displayTextValue}
                  onChange={(nextValue) =>
                    onStylePropertyCommit?.({
                      property: 'displayText',
                      value: nextValue,
                    })
                  }
                  onPreview={(nextValue) =>
                    onStylePropertyPreview?.({
                      property: 'displayText',
                      value: nextValue,
                    })
                  }
                  onCancel={() => editGestureController.cancel()}
                  placeholder={isMixed ? 'Mixed' : value}
                  width="54px"
                  isMixed={isMixed}
                />
              );
            })()}
          </PropertyRow>
        )}

        {!hideFontControls && (
          <>
            <PropertyRow label={t('propertiesPanel.font') || '폰트'}>
              {getMixedValue((pos) => pos.fontFamily, null).isMixed ? (
                <span className="text-fg-faint text-body italic">Mixed</span>
              ) : null}
              <FontPickerOpenButton
                activePageKey={activePageKey}
                pageKey={FONT_PAGE_KEY}
                onOpen={() => openPage(FONT_PAGE_KEY)}
                onClose={closePage}
              >
                {t('propertiesPanel.configure') || '설정하기'}
              </FontPickerOpenButton>
            </PropertyRow>

            <PropertyRow label={t('propertiesPanel.fontSize') || '글꼴 크기'}>
              {getMixedValue((pos) => pos.fontSize, 14).isMixed ? (
                <span className="text-fg-faint text-body italic">Mixed</span>
              ) : null}
              <NumberInput
                value={getMixedValue((pos) => pos.fontSize, 14).value}
                onChange={(value) =>
                  onStylePropertyCommit?.({ property: 'fontSize', value })
                }
                onPreview={(value) =>
                  onStylePropertyPreview?.({ property: 'fontSize', value })
                }
                onCancel={() => editGestureController.cancel()}
                suffix="px"
                min={8}
                max={72}
                allowDecimal
                decimalScale={1}
              />
            </PropertyRow>

            <PropertyRow label={t('propertiesPanel.fontWeight') || '글꼴 굵기'}>
              {(() => {
                const weightState = getMixedValue(
                  (pos) => pos.fontWeight,
                  DEFAULT_ELEMENT_BASE_FONT_WEIGHT,
                );
                return (
                  <FontWeightDropdown
                    fontFamilies={getSelectedKeysData().map(
                      ({ position }) => position?.fontFamily,
                    )}
                    value={weightState.value}
                    isMixed={weightState.isMixed}
                    onChange={(value) =>
                      onElementPropertyCommit?.({ fontWeight: value })
                    }
                  />
                );
              })()}
            </PropertyRow>

            <PropertyRow label={t('propertiesPanel.fontColor') || '글꼴 색상'}>
              {(
                effectiveColorState === 'active'
                  ? getActiveMixedValue(
                      (pos) => fontColorFor(pos, true),
                      DEFAULT_ELEMENT_ACTIVE_FONT,
                    ).isMixed
                  : getMixedValue(
                      (pos) => fontColorFor(pos, false),
                      DEFAULT_ELEMENT_FONT,
                    ).isMixed
              ) ? (
                <span className="text-fg-faint text-body italic">Mixed</span>
              ) : null}
              <ColorInput
                colorId={`batch-font:${batchSelectionKey}`}
                gradientSurface="font"
                {...mixedFontColorParts(
                  (pos) => fontColorFor(pos, effectiveColorState === 'active'),
                  effectiveColorState === 'active'
                    ? DEFAULT_ELEMENT_ACTIVE_FONT
                    : DEFAULT_ELEMENT_FONT,
                )}
                value={
                  getMixedValue(
                    (pos) => fontColorFor(pos, false),
                    DEFAULT_ELEMENT_FONT,
                  ).value
                }
                activeValue={
                  getActiveMixedValue(
                    (pos) => fontColorFor(pos, true),
                    DEFAULT_ELEMENT_ACTIVE_FONT,
                  ).value
                }
                showStateTabs={showActiveState}
                stateMode={effectiveColorState}
                onStateModeChange={onColorStateChange}
                onChange={() => {}}
                onChangeComplete={() => {}}
                onActiveChangeComplete={() => {}}
                onCancel={() => editGestureController.cancel()}
                panelElement={panelElement}
                canvasAnchor={{ kind: 'batch' }}
                gradientValue={
                  getMixedValue(
                    (pos) => fontColorPairFor(pos, false).gradient ?? null,
                    null,
                  ).value
                }
                activeGradientValue={
                  getActiveMixedValue(
                    (pos) => fontColorPairFor(pos, true).gradient ?? null,
                    null,
                  ).value
                }
                onModePreview={(state, modeValue) =>
                  onFontColorPreview?.(
                    state === 'active'
                      ? {
                          property: 'activeFontPaint',
                          value: paintDescriptor(modeValue),
                        }
                      : {
                          property: 'fontPaint',
                          value: paintDescriptor(modeValue),
                        },
                  )
                }
                onModeCommit={(state, modeValue) =>
                  onFontColorCommit?.(
                    state === 'active'
                      ? {
                          property: 'activeFontPaint',
                          value: paintDescriptor(modeValue),
                        }
                      : {
                          property: 'fontPaint',
                          value: paintDescriptor(modeValue),
                        },
                  )
                }
              />
            </PropertyRow>

            <PropertyRow
              label={t('propertiesPanel.fontStyle') || '글꼴 스타일'}
            >
              <FontStyleToggle
                isBold={
                  getMixedValue(
                    (pos) =>
                      pos.fontBold ??
                      (pos.fontWeight == null
                        ? DEFAULT_ELEMENT_FONT_BOLD
                        : pos.fontWeight === 700),
                    DEFAULT_ELEMENT_FONT_BOLD,
                  ).value
                }
                isItalic={getMixedValue((pos) => pos.fontItalic, false).value}
                isUnderline={
                  getMixedValue((pos) => pos.fontUnderline, false).value
                }
                isStrikethrough={
                  getMixedValue((pos) => pos.fontStrikethrough, false).value
                }
                {...createFontStyleToggleHandlers((property, value) =>
                  onElementPropertyCommit?.({ [property]: value }),
                )}
              />
            </PropertyRow>
          </>
        )}
      </PropertySection>

      {!hideFontControls &&
        renderPageKey === FONT_PAGE_KEY &&
        pageHost &&
        createPortal(
          <FontPicker
            open
            selectedFont={getMixedValue((pos) => pos.fontFamily, null).value}
            onFontSelect={(fontName) => {
              if (fontName === null) return;
              const weightState = getMixedValue(
                (pos) => pos.fontWeight,
                DEFAULT_ELEMENT_BASE_FONT_WEIGHT,
              );
              const nextWeight = resolveSupportedFontWeight(
                fontName,
                useFontStore.getState().getAllFonts(),
              );
              // 폰트와 지원 굵기 재선택을 동일 undo 단계로 커밋
              const gestureId = crypto.randomUUID();
              onElementPropertyCommit?.(
                { fontFamily: fontName },
                { gestureId },
              );
              if (weightState.isMixed || nextWeight !== weightState.value) {
                onElementPropertyCommit?.(
                  { fontWeight: nextWeight },
                  { gestureId },
                );
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

export default BatchTypographySection;
