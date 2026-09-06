import React from 'react';
import CountDisplay from '@components/overlay/counters/CountDisplay';
import type {
  CounterAnimationBezier,
  KeyCounterSettings,
} from '@src/types/key/keys';
import {
  DEFAULT_ELEMENT_ACTIVE_FONT,
  DEFAULT_ELEMENT_FONT,
  DEFAULT_COUNTER_FONT_SIZE,
  DEFAULT_COUNTER_FONT_WEIGHT,
} from '@utils/element/elementDefaults';
import {
  computeCounterAnimationPreviewKeyStyles,
  type CounterAnimationKeyVisual,
} from '@utils/counter/counterAnimationPreview';

interface CounterAnimationPreviewStageProps {
  counterSettings?: KeyCounterSettings;
  keyVisual?: CounterAnimationKeyVisual;
  animationBezier: CounterAnimationBezier;
  animationScale: number;
  animationDurationMs: number;
  count: number;
  active: boolean;
  gridMinorColor: string;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  t: (key: string) => string;
}

const CounterAnimationPreviewStage = ({
  counterSettings,
  keyVisual,
  animationBezier,
  animationScale,
  animationDurationMs,
  count,
  active,
  gridMinorColor,
  onPointerDown,
  t,
}: CounterAnimationPreviewStageProps) => {
  const PREVIEW_MAX_W = 200;
  const PREVIEW_MAX_H = 160;

  const placement = counterSettings?.placement ?? 'inside';
  const align = counterSettings?.align ?? 'top';
  const alignMode = counterSettings?.alignMode ?? 'center';
  const gap = counterSettings?.gap ?? 4;
  const isInside = placement === 'inside';
  const isHorizontal = align === 'left' || align === 'right';
  const isBetween = alignMode === 'between';

  const keyW = keyVisual?.width ?? 60;
  const keyH = keyVisual?.height ?? 60;
  const counterExtra =
    (counterSettings?.fontSize ?? DEFAULT_COUNTER_FONT_SIZE) + gap;

  let totalW = keyW;
  let totalH = keyH;
  if (!isInside) {
    if (align === 'left' || align === 'right') totalW += counterExtra;
    else totalH += counterExtra;
  }

  const fitScale = Math.min(PREVIEW_MAX_W / totalW, PREVIEW_MAX_H / totalH, 1);
  const keyActive = active && !keyVisual?.isStat;
  const {
    keyStyle: computedKeyStyle,
    borderRingStyle,
    imageStyle,
    textStyle,
    currentImageSrc,
    hasCurrentImage,
    imageMode,
    imageReplaces,
    isTransparent,
    labelText,
    useInline,
  } = computeCounterAnimationPreviewKeyStyles({
    keyVisual,
    active: keyActive,
    width: keyW,
    height: keyH,
  });

  const labelEl = (
    <span
      className="pointer-events-none select-none leading-none text-safe-inline"
      style={textStyle}
    >
      {labelText}
    </span>
  );

  const counterEl = (
    <CountDisplay
      count={count}
      fillColor={
        keyActive
          ? counterSettings?.fill.active ?? DEFAULT_ELEMENT_ACTIVE_FONT
          : counterSettings?.fill.idle ?? DEFAULT_ELEMENT_FONT
      }
      fillGradient={
        keyActive
          ? counterSettings?.fillActiveGradient ?? null
          : counterSettings?.fillIdleGradient ?? null
      }
      globalKey="preview"
      active={keyActive}
      fontSize={counterSettings?.fontSize ?? DEFAULT_COUNTER_FONT_SIZE}
      fontFamily={counterSettings?.fontFamily ?? null}
      fontWeight={counterSettings?.fontWeight ?? DEFAULT_COUNTER_FONT_WEIGHT}
      fontBold={counterSettings?.fontBold ?? false}
      fontItalic={counterSettings?.fontItalic ?? false}
      fontUnderline={counterSettings?.fontUnderline ?? false}
      fontStrikethrough={counterSettings?.fontStrikethrough ?? false}
      animationEnabled={true}
      animationBezier={animationBezier}
      animationScale={animationScale}
      useInlineStyles={useInline}
      animationDurationMs={animationDurationMs}
    />
  );

  const keyBoxStyle: React.CSSProperties = {
    ...computedKeyStyle,
    transform: 'none',
    display: isTransparent ? 'none' : undefined,
    zIndex: undefined,
    cursor: undefined,
  };

  const outsideStyle: React.CSSProperties | undefined = !isInside
    ? {
        position: 'absolute',
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...(align === 'top' && {
          bottom: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          paddingBottom: `${gap}px`,
        }),
        ...(align === 'bottom' && {
          top: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          paddingTop: `${gap}px`,
        }),
        ...(align === 'left' && {
          right: '100%',
          top: '50%',
          transform: 'translateY(-50%)',
          paddingRight: `${gap}px`,
        }),
        ...(align === 'right' && {
          left: '100%',
          top: '50%',
          transform: 'translateY(-50%)',
          paddingLeft: `${gap}px`,
        }),
      }
    : undefined;

  return (
    <div className="w-[300px] shrink-0 min-h-0 bg-fill-faint rounded-surface p-[10px] flex flex-col">
      <div
        className="flex-1 min-h-0 flex items-center justify-center relative bg-inset rounded-md overflow-hidden cursor-pointer select-none"
        onPointerDown={onPointerDown}
      >
        {/* 그리드 — 커브 캔버스와 동일 팔레트 */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(${gridMinorColor} 1px, transparent 1px), linear-gradient(90deg, ${gridMinorColor} 1px, transparent 1px)`,
            backgroundSize: '40px 40px',
            backgroundPosition: 'center center',
          }}
        />
        <div
          className="relative z-10 w-full h-full flex items-center justify-center"
          data-dmn-user-css-scope=""
        >
          <div
            className="relative"
            style={
              fitScale < 1
                ? {
                    transform: `scale(${fitScale})`,
                    transformOrigin: 'center',
                  }
                : undefined
            }
          >
            <div
              className={`relative flex items-center justify-center ${
                keyVisual?.className || ''
              }`}
              style={keyBoxStyle}
              data-state={keyActive ? 'active' : 'inactive'}
              data-key-element="true"
              data-key-image={hasCurrentImage ? 'true' : undefined}
              data-key-image-mode={hasCurrentImage ? imageMode : undefined}
            >
              {borderRingStyle && (
                <span
                  aria-hidden="true"
                  data-gradient-border-ring="true"
                  style={borderRingStyle}
                />
              )}
              {hasCurrentImage && (
                <img
                  src={currentImageSrc || ''}
                  alt=""
                  data-key-image-layer="true"
                  style={imageStyle}
                  draggable={false}
                />
              )}
              {imageReplaces ? null : isInside ? (
                <div
                  className={`flex ${
                    isHorizontal ? '' : 'flex-col'
                  } w-full h-full items-center pointer-events-none select-none`}
                  style={{
                    justifyContent: isBetween ? 'space-between' : 'center',
                    padding: isBetween
                      ? isHorizontal
                        ? `0 ${gap}px`
                        : `${gap}px 0`
                      : '0',
                    gap: isBetween ? undefined : `${gap}px`,
                  }}
                >
                  {(align === 'top' || align === 'left') && counterEl}
                  {labelEl}
                  {(align === 'bottom' || align === 'right') && counterEl}
                </div>
              ) : (
                labelEl
              )}
            </div>
            {!isInside && outsideStyle && (
              <div
                className={keyVisual?.className || undefined}
                style={outsideStyle}
              >
                {counterEl}
              </div>
            )}
          </div>
        </div>
        {/* 하단 안내 — 스크림 없이 흐린 캡션만 */}
        <div className="absolute inset-x-0 bottom-[10px] z-20 text-center pointer-events-none">
          <span className="text-caption text-fg-faint">
            {t('counterSetting.pressToPreview') || '눌러서 미리보기'}
          </span>
        </div>
      </div>
    </div>
  );
};

export default CounterAnimationPreviewStage;
