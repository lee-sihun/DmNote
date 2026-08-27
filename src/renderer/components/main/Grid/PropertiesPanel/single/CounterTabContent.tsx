/* eslint-disable react-hooks/set-state-in-effect */
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CounterTabContentProps } from '../types';
import type { KeyCounterAnimationSettings } from '@src/types/key/keys';
import { normalizeCounterSettings } from '@src/types/key/keys';
import {
  PropertyRow,
  FontStyleToggle,
  NumberInput,
  PropertySection,
} from '../PropertyInputs';
import Checkbox from '@components/main/common/Checkbox';
import Dropdown from '@components/main/common/Dropdown';
import ColorPicker from '@components/main/Modal/content/pickers/ColorPicker';
import PopupExit from '@components/main/Modal/PopupExit';
import FontPicker from '@components/main/Modal/content/pickers/FontPicker';
import FontPickerOpenButton from '@components/main/Modal/content/pickers/FontPickerOpenButton';
import FontWeightDropdown from '../FontWeightDropdown';
import CounterAnimationPicker from '@components/main/Modal/content/pickers/CounterAnimationPicker';
import { usePanelNav } from '../PanelNavContext';
import { ColorSwatchButton } from '@components/main/Modal/content/pickers/ColorSwatch';
import {
  DEFAULT_COUNTER_FONT_SIZE,
  DEFAULT_COUNTER_FONT_WEIGHT,
} from '@utils/core/elementDefaults';
import { useGradientColorState } from '@hooks/pickers/useGradientColorState';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useFontStore } from '@stores/useFontStore';
import { isNativeElementId } from '@src/renderer/editor/model/elementId';
import { editGestureController } from '@src/renderer/editor/runtime/editGestureController';
import { createCounterAnimationPresetIntent } from '@src/types/key/counterAnimation';
import {
  counterFillPair,
  gradientToCss,
  type ColorModeValue,
} from '@src/types/color';
import { resolveSupportedFontWeight } from '@utils/core/fontWeights';

// 인-패널 서브 페이지 키 — 트리거 사이트별 유니크
const FONT_PAGE_KEY = 'single-counter:font';
const ANIMATION_PAGE_KEY = 'single-counter:animation';

type PickerTarget = 'fill' | null;
type ColorState = 'idle' | 'active';

const CounterTabContent: React.FC<CounterTabContentProps> = ({
  keyPosition,
  keyDisplayName,
  isStat,
  onCounterEnabledCommit,
  onCounterAnimationEnabledCommit,
  onCounterLayoutCommit,
  onCounterTypographyCommit,
  onCounterFillCommit,
  onCounterAnimationPresetCommit,
  panelElement,
  t,
}) => {
  const fillBtnRef = useRef<HTMLButtonElement>(null);

  const [pickerFor, setPickerFor] = useState<PickerTarget>(null);
  const pickerOpen = pickerFor !== null;
  const [colorState, setColorState] = useState<ColorState>('idle');
  const showActiveState = !isStat;
  const effectiveColorState = showActiveState ? colorState : 'idle';
  const selectedKeyType = useKeyStore((state) => state.selectedKeyType);

  useEffect(() => {
    if (!showActiveState) {
      setColorState('idle');
      setPickerFor(null);
    }
  }, [showActiveState]);

  // 인-패널 내비게이션 (폰트/애니메이션 서브 페이지)
  const { activePageKey, renderPageKey, openPage, closePage, pageHost } =
    usePanelNav();

  const counterSettings = normalizeCounterSettings(keyPosition.counter);

  // 로컬 색상 상태 (드래그 중 UI 업데이트용)
  const [localColors, setLocalColors] = useState({
    fillIdle: counterSettings.fill.idle,
    fillActive: counterSettings.fill.active,
  });

  // 피커가 닫혀있을 때만 외부 prop과 동기화
  useEffect(() => {
    if (!pickerOpen) {
      setLocalColors({
        fillIdle: counterSettings.fill.idle,
        fillActive: counterSettings.fill.active,
      });
    }
  }, [pickerOpen, counterSettings.fill.idle, counterSettings.fill.active]);

  const colorPickerInteractiveRefs = [fillBtnRef];

  const handleAnimationUpdate = (
    nextAnimation: KeyCounterAnimationSettings,
  ) => {
    onCounterAnimationPresetCommit?.(
      createCounterAnimationPresetIntent(
        counterSettings.animation,
        nextAnimation,
        'single',
      ),
    );
  };

  const handlePickerToggle = (target: Exclude<PickerTarget, null>) => {
    setPickerFor((prev) => (prev === target ? null : target));
    // 새로 열 때는 항상 대기 탭에서 시작
    if (pickerFor !== target) setColorState('idle');
  };

  const getDisplayColor = (color: string): string => {
    if (!color) return '#ffffff';
    if (color.startsWith('rgba') || color.startsWith('rgb')) return color;
    if (color.startsWith('#')) return color;
    return '#ffffff';
  };

  const activeColorFor = (state: ColorState): string =>
    state === 'active' ? localColors.fillActive : localColors.fillIdle;

  // 드래그 중 로컬 상태만 업데이트 (부모에게 전달 안함)
  const handleColorChange = (color: string) => {
    if (!pickerFor) return;
    const key = effectiveColorState === 'active' ? 'fillActive' : 'fillIdle';
    setLocalColors((prev) => ({ ...prev, [key]: color }));
  };

  // ── fill 그라데이션 배선 ──

  const storedFillGradient =
    effectiveColorState === 'active'
      ? counterSettings.fillActiveGradient ?? null
      : counterSettings.fillIdleGradient ?? null;

  const handleFillCommit = (value: ColorModeValue) => {
    const pair = counterFillPair(value);
    const key = effectiveColorState === 'active' ? 'fillActive' : 'fillIdle';
    setLocalColors((prev) => ({ ...prev, [key]: pair.color }));
    onCounterFillCommit?.(
      effectiveColorState === 'active'
        ? {
            property: 'counterFillActive',
            value: pair.gradient
              ? { color: pair.color, gradient: pair.gradient }
              : { color: pair.color },
          }
        : {
            property: 'counterFillIdle',
            value: pair.gradient
              ? { color: pair.color, gradient: pair.gradient }
              : { color: pair.color },
          },
    );
  };

  const fillGradientState = useGradientColorState({
    pair:
      pickerFor === 'fill'
        ? {
            color: activeColorFor(effectiveColorState),
            gradient: storedFillGradient,
          }
        : {},
    fallbackColor: '#ffffff',
    // 요소 종류·키 모드 포함 — 형식 왕복 기억이 다른 대상과 교차하지 않게
    contextKey: `${isStat ? 'stat' : 'key'}:${selectedKeyType}:${
      keyPosition.id
    }:fill:${effectiveColorState}`,
    canvasAnchor:
      pickerFor === 'fill' &&
      keyPosition.id &&
      isNativeElementId(keyPosition.id)
        ? { kind: isStat ? 'stat' : 'key', id: keyPosition.id }
        : undefined,
    canvasSurface: 'counterFill',
    canvasState: effectiveColorState,
    onPreview: (value) => {
      if (value.mode === 'solid') handleColorChange(value.color);
    },
    onCancel: () => editGestureController.cancel(),
    onCommit: handleFillCommit,
  });

  return (
    <>
      <PropertySection>
        {/* 카운터 사용 */}
        <div className="flex justify-between items-center w-full min-h-[32px]">
          <p className="text-fg-muted text-label">
            {t('counterSetting.counterEnabled') || '카운터 표시'}
          </p>
          <Checkbox
            commitStrategy="after-paint"
            checked={counterSettings.enabled}
            onChange={() => {
              const enabled = !counterSettings.enabled;
              onCounterEnabledCommit?.(enabled);
            }}
          />
        </div>
      </PropertySection>

      <PropertySection>
        {/* 배치 영역 */}
        <PropertyRow label={t('counterSetting.placementArea') || '배치 영역'}>
          <Dropdown
            commitStrategy="after-paint"
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
            onChange={(value) => {
              const placement = value as 'inside' | 'outside';
              onCounterLayoutCommit?.({
                property: 'counterPlacement',
                value: placement,
              });
            }}
          />
        </PropertyRow>

        {/* 정렬 방향 */}
        <PropertyRow label={t('counterSetting.alignDirection') || '정렬 방향'}>
          <Dropdown
            commitStrategy="after-paint"
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
            value={counterSettings.align}
            onChange={(value) => {
              const align = value as 'top' | 'bottom' | 'left' | 'right';
              onCounterLayoutCommit?.({
                property: 'counterAlign',
                value: align,
              });
            }}
          />
        </PropertyRow>

        {/* 정렬 방식 (내부 배치 전용) */}
        {counterSettings.placement === 'inside' && (
          <PropertyRow label={t('counterSetting.alignMode') || '정렬 방식'}>
            <Dropdown
              commitStrategy="after-paint"
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
              onChange={(value) => {
                const alignMode = value as 'center' | 'between';
                onCounterLayoutCommit?.({
                  property: 'counterAlignMode',
                  value: alignMode,
                });
              }}
            />
          </PropertyRow>
        )}

        {/* 간격 */}
        <PropertyRow label={t('counterSetting.gap') || '간격'}>
          <NumberInput
            value={counterSettings.gap}
            onChange={(value) => {
              onCounterLayoutCommit?.({ property: 'counterGap', value: value });
            }}
            suffix="px"
            min={0}
            max={9999}
            width="54px"
          />
        </PropertyRow>
      </PropertySection>

      <PropertySection>
        {/* 채우기 색상 */}
        <PropertyRow label={t('counterSetting.fill') || '채우기'}>
          <ColorSwatchButton
            ref={fillBtnRef}
            type="button"
            onClick={() => handlePickerToggle('fill')}
            open={pickerFor === 'fill'}
            className="w-[23px] h-[23px] rounded-md cursor-pointer transition-shadow flex-shrink-0"
            surfaceClassName="rounded-md"
            color={getDisplayColor(activeColorFor(effectiveColorState))}
            image={
              storedFillGradient ? gradientToCss(storedFillGradient) : undefined
            }
          />
        </PropertyRow>
      </PropertySection>

      <PropertySection>
        {/* 폰트 */}
        <PropertyRow label={t('counterSetting.font') || '폰트'}>
          <FontPickerOpenButton
            activePageKey={activePageKey}
            pageKey={FONT_PAGE_KEY}
            onBeforeOpen={() => setPickerFor(null)}
            onOpen={() => openPage(FONT_PAGE_KEY)}
            onClose={closePage}
          >
            {t('propertiesPanel.configure') || '설정하기'}
          </FontPickerOpenButton>
        </PropertyRow>

        {/* 폰트 크기 */}
        <PropertyRow label={t('counterSetting.fontSize') || '폰트 크기'}>
          <NumberInput
            value={counterSettings.fontSize ?? DEFAULT_COUNTER_FONT_SIZE}
            onChange={(value) => {
              onCounterTypographyCommit?.({
                property: 'counterFontSize',
                value: value,
              });
            }}
            suffix="px"
            min={8}
            max={72}
            width="54px"
          />
        </PropertyRow>

        {/* 폰트 굵기 */}
        <PropertyRow label={t('counterSetting.fontWeight') || '폰트 굵기'}>
          <FontWeightDropdown
            fontFamilies={[
              counterSettings.fontFamily ??
                (counterSettings.placement === 'inside'
                  ? keyPosition.fontFamily ?? null
                  : null),
            ]}
            value={counterSettings.fontWeight ?? DEFAULT_COUNTER_FONT_WEIGHT}
            onChange={(value) => {
              onCounterTypographyCommit?.({
                property: 'counterFontWeight',
                value,
              });
            }}
          />
        </PropertyRow>

        {/* 폰트 스타일 */}
        <PropertyRow label={t('counterSetting.fontStyle') || '폰트 스타일'}>
          <FontStyleToggle
            isBold={counterSettings.fontBold ?? false}
            isItalic={counterSettings.fontItalic ?? false}
            isUnderline={counterSettings.fontUnderline ?? false}
            isStrikethrough={counterSettings.fontStrikethrough ?? false}
            onBoldChange={(value) => {
              onCounterTypographyCommit?.({
                property: 'counterFontBold',
                value,
              });
            }}
            onItalicChange={(value) => {
              onCounterTypographyCommit?.({
                property: 'counterFontItalic',
                value: value,
              });
            }}
            onUnderlineChange={(value) => {
              onCounterTypographyCommit?.({
                property: 'counterFontUnderline',
                value: value,
              });
            }}
            onStrikethroughChange={(value) => {
              onCounterTypographyCommit?.({
                property: 'counterFontStrikethrough',
                value: value,
              });
            }}
          />
        </PropertyRow>
      </PropertySection>

      <PropertySection>
        {/* 카운터 애니메이션 */}
        <div className="flex justify-between items-center w-full min-h-[32px]">
          <p className="text-fg-muted text-label">
            {t('counterSetting.animationEnabled') || '카운터 애니메이션'}
          </p>
          <Checkbox
            commitStrategy="after-paint"
            checked={counterSettings.animation.enabled}
            onChange={() => {
              const enabled = !counterSettings.animation.enabled;
              onCounterAnimationEnabledCommit?.(enabled);
            }}
          />
        </div>

        <PropertyRow label={t('counterSetting.animation') || '애니메이션 설정'}>
          <button
            type="button"
            className={`px-[8px] h-[23px] bg-fill hover:bg-fill-hover active:bg-fill-active transition-colors duration-fast rounded-md flex items-center justify-center ${
              activePageKey === ANIMATION_PAGE_KEY ? 'shadow-focus-ring' : ''
            } text-fg text-body`}
            onClick={() => {
              setPickerFor(null);
              if (activePageKey === ANIMATION_PAGE_KEY) closePage();
              else openPage(ANIMATION_PAGE_KEY);
            }}
          >
            {t('propertiesPanel.configure') || '설정하기'}
          </button>
        </PropertyRow>
      </PropertySection>

      <PopupExit open={Boolean(pickerFor)}>
        {pickerFor ? (
          <ColorPicker
            open={pickerOpen}
            referenceRef={fillBtnRef}
            panelElement={panelElement}
            color={fillGradientState.pickerColor}
            onColorChange={(c: string) =>
              fillGradientState.handlePickerColorChange(c, false)
            }
            onColorChangeComplete={(c: string) =>
              fillGradientState.handlePickerColorChange(c, true)
            }
            onInputCancel={() => {
              fillGradientState.cancelPreview();
              editGestureController.cancel();
            }}
            onClose={() => setPickerFor(null)}
            solidOnly={true}
            interactiveRefs={colorPickerInteractiveRefs}
            stateMode={showActiveState ? effectiveColorState : undefined}
            onStateModeChange={
              showActiveState
                ? (mode: string) => setColorState(mode as ColorState)
                : undefined
            }
            headerSlot={fillGradientState.headerSlot}
            footerSlot={fillGradientState.footerSlot}
            gradientSpec={fillGradientState.paletteGradientSpec}
            onGradientSpecSelect={fillGradientState.handleGradientSpecSelect}
          />
        ) : null}
      </PopupExit>

      {/* FontPicker — 패널 서브 페이지 */}
      {renderPageKey === FONT_PAGE_KEY &&
        pageHost &&
        createPortal(
          <FontPicker
            open
            selectedFont={counterSettings.fontFamily || null}
            onFontSelect={(fontName) => {
              if (fontName !== null) {
                const currentWeight =
                  counterSettings.fontWeight ?? DEFAULT_COUNTER_FONT_WEIGHT;
                const nextWeight = resolveSupportedFontWeight(
                  fontName,
                  useFontStore.getState().getAllFonts(),
                );
                // 굵기 재선택은 폰트 변경과 한 undo 단계
                const gestureId = crypto.randomUUID();
                onCounterTypographyCommit?.(
                  { property: 'counterFontFamily', value: fontName },
                  { gestureId },
                );
                if (nextWeight !== currentWeight) {
                  onCounterTypographyCommit?.(
                    { property: 'counterFontWeight', value: nextWeight },
                    { gestureId },
                  );
                }
              }
            }}
            pageTitle={t('counterSetting.font') || '폰트'}
            onBack={closePage}
          />,
          pageHost,
        )}

      {/* CounterAnimationPicker — 패널 서브 페이지 */}
      {renderPageKey === ANIMATION_PAGE_KEY &&
        pageHost &&
        createPortal(
          <CounterAnimationPicker
            open
            completionBinding="element-id"
            animation={counterSettings.animation}
            counterSettings={counterSettings}
            keyVisual={{
              ...keyPosition,
              displayName: keyDisplayName,
              isStat,
            }}
            onAnimationChange={handleAnimationUpdate}
            t={t}
            pageTitle={t('counterSetting.animation') || '애니메이션'}
            onBack={closePage}
          />,
          pageHost,
        )}
    </>
  );
};

export default CounterTabContent;
