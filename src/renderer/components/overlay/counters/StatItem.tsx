'use no memo';
import React, { useEffect } from 'react';
import { useSignals } from '@preact/signals-react/runtime';
import { getStatValueSignal } from '@stores/signals/statsSignals';
import type { StatItemType } from '@src/types/key/statItems';
import { useCounterSettings } from '@hooks/overlay/useCounterSettings';
import { resolveImageSource } from '@utils/core/imageSource';
import { warmupImageSource } from '@utils/core/imageWarmup';
import CountDisplay from '@components/overlay/counters/CountDisplay';

interface StatItemPosition {
  hidden?: boolean;
  dx: number;
  dy: number;
  width: number;
  height?: number;
  activeImage?: string;
  inactiveImage?: string;
  activeTransparent?: boolean;
  idleTransparent?: boolean;
  className?: string;
  backgroundColor?: string;
  activeBackgroundColor?: string;
  borderColor?: string;
  activeBorderColor?: string;
  borderWidth?: number;
  borderRadius?: number;
  fontSize?: number;
  fontColor?: string;
  activeFontColor?: string;
  fontFamily?: string;
  idleImageFit?: string;
  activeImageFit?: string;
  imageFit?: string;
  useInlineStyles?: boolean;
  displayText?: string;
  fontWeight?: number;
  fontItalic?: boolean;
  fontUnderline?: boolean;
  fontStrikethrough?: boolean;
  counter?: unknown;
  zIndex?: number;
}

interface StatItemProps {
  statType: string;
  position: StatItemPosition;
  label?: string;
  counterEnabled?: boolean;
  active?: boolean;
}

export default function StatItem({
  statType,
  position,
  label,
  counterEnabled = false,
  active = false,
}: StatItemProps) {
  useSignals();

  const {
    dx,
    dy,
    width,
    height = 60,
    activeImage,
    inactiveImage,
    activeTransparent = false,
    idleTransparent = false,
    className,
    backgroundColor,
    activeBackgroundColor,
    borderColor,
    activeBorderColor,
    borderWidth,
    borderRadius,
    fontSize,
    fontColor,
    activeFontColor,
    fontFamily,
    idleImageFit,
    activeImageFit,
    imageFit,
    useInlineStyles,
    displayText,
    // 글꼴 스타일
    fontWeight,
    fontItalic,
    fontUnderline,
    fontStrikethrough,
    // 카운터
    counter,
  } = position;

  const stateBackgroundColor: string | undefined = active
    ? activeBackgroundColor ?? backgroundColor
    : backgroundColor;
  const stateBorderColor: string | undefined = active
    ? activeBorderColor ?? borderColor
    : borderColor;
  const stateFontColor: string | undefined = active
    ? activeFontColor ?? fontColor
    : fontColor;

  const inactiveImageSrc: string | null = resolveImageSource(inactiveImage);
  const activeImageSrc: string | null = resolveImageSource(activeImage);

  // 상태 전환 직전 이미지 디코드를 미리 수행해 첫 렌더 끊김을 줄임
  useEffect(() => {
    warmupImageSource(inactiveImageSrc);
    warmupImageSource(activeImageSrc);
  }, [inactiveImageSrc, activeImageSrc]);

  const isTransparent: boolean = active ? activeTransparent : idleTransparent;

  const useInline: boolean = useInlineStyles === true;
  const labelText: string = displayText || label || '';

  // 활성 상태에서 activeImage가 없으면 inactiveImage를 fallback으로 사용
  const currentImageSrc: string | null =
    (active && activeImageSrc ? activeImageSrc : inactiveImageSrc) || null;
  const hasCurrentImage: boolean = !!currentImageSrc;
  const isUsingActiveImage: boolean = active && !!activeImageSrc;
  const effectiveImageFit: string = isUsingActiveImage
    ? activeImageFit || imageFit || 'cover'
    : idleImageFit || imageFit || 'cover';

  const counterSettings = useCounterSettings(counter);

  const showInsideCounter: boolean =
    counterEnabled &&
    counterSettings.enabled &&
    counterSettings.placement === 'inside';

  const counterValue: number = showInsideCounter
    ? (getStatValueSignal(statType as StatItemType).value ?? 0) | 0
    : 0;

  const defaultBgColor: string = hasCurrentImage
    ? 'transparent'
    : active
    ? 'rgba(121, 121, 121, 0.9)'
    : 'rgba(46, 46, 47, 0.9)';
  const defaultBorderColor: string = active
    ? 'rgba(255, 255, 255, 0.9)'
    : 'rgba(113, 113, 113, 0.9)';
  const defaultTextColor: string =
    active && !activeImageSrc ? '#FFFFFF' : 'rgba(121, 121, 121, 0.9)';

  const keyStyle: React.CSSProperties = {
    width: `${width}px`,
    height: `${height}px`,
    transform: `translate3d(calc(${dx}px + var(--key-offset-x, 0px)), calc(${dy}px + var(--key-offset-y, 0px)), 0)`,
    backgroundColor:
      useInline && stateBackgroundColor
        ? stateBackgroundColor
        : `var(--key-bg, ${stateBackgroundColor || defaultBgColor})`,
    borderRadius:
      useInline && borderRadius != null
        ? `${borderRadius}px`
        : `var(--key-radius, ${
            borderRadius != null ? `${borderRadius}px` : '10px'
          })`,
    border:
      useInline && (stateBorderColor || borderWidth != null)
        ? `${borderWidth ?? 3}px solid ${
            stateBorderColor || defaultBorderColor
          }`
        : `var(--key-border, ${borderWidth ?? 3}px solid ${
            stateBorderColor || defaultBorderColor
          })`,
    color:
      useInline && stateFontColor
        ? stateFontColor
        : `var(--key-text-color, ${stateFontColor || defaultTextColor})`,
    fontSize: fontSize ? `${fontSize}px` : undefined,
    overflow: 'hidden' as const,
    willChange: active ? 'transform, background-color' : 'transform',
    backfaceVisibility: 'hidden' as const,
    transformStyle: 'preserve-3d' as const,
    contain: 'layout style paint',
    imageRendering: 'auto' as const,
    isolation: 'isolate' as const,
    boxSizing: 'border-box' as const,
    zIndex: position.zIndex,
    cursor: 'default',
  };

  const fallbackImageDimmed: boolean =
    active && !activeImageSrc && !!inactiveImageSrc;
  const imageStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: effectiveImageFit as React.CSSProperties['objectFit'],
    display: 'block',
    pointerEvents: 'none' as const,
    userSelect: 'none' as const,
    position: 'relative' as const,
    zIndex: 0,
    // mask 오버레이 없이 필터만 적용해 페인트 비용을 줄임
    filter: fallbackImageDimmed ? 'brightness(0.62)' : 'none',
  };

  const textDecorations: string[] = [];
  if (fontUnderline) textDecorations.push('underline');
  if (fontStrikethrough) textDecorations.push('line-through');

  const textStyle: React.CSSProperties = {
    willChange: 'auto',
    contain: 'layout style paint',
    fontSize: fontSize ? `${fontSize}px` : undefined,
    fontFamily: fontFamily
      ? `"${fontFamily}", "SUIT-Regular", sans-serif`
      : undefined,
    fontWeight: fontWeight ?? 700,
    fontStyle: fontItalic ? ('italic' as const) : ('normal' as const),
    textDecoration:
      textDecorations.length > 0 ? textDecorations.join(' ') : 'none',
  };

  if (position?.hidden || isTransparent) return null;

  const counterFillColor: string = active
    ? counterSettings.fill.active
    : counterSettings.fill.idle;
  const counterStrokeColor: string = active
    ? counterSettings.stroke.active
    : counterSettings.stroke.idle;
  const contentGap: number = Number.isFinite(counterSettings.gap)
    ? counterSettings.gap
    : 6;

  const renderInsideLayout = (): React.ReactNode => {
    if (!showInsideCounter) {
      return null;
    }

    const counterElement = (
      <CountDisplay
        key="counter"
        count={counterValue}
        fillColor={counterFillColor}
        strokeColor={counterStrokeColor}
        active={active}
        fontSize={counterSettings.fontSize}
        fontFamily={counterSettings.fontFamily}
        fontWeight={counterSettings.fontWeight}
        fontItalic={counterSettings.fontItalic}
        fontUnderline={counterSettings.fontUnderline}
        fontStrikethrough={counterSettings.fontStrikethrough}
        animationEnabled={counterSettings.animation.enabled}
        animationBezier={counterSettings.animation.bezier}
        animationScale={counterSettings.animation.scale}
        animationDurationMs={counterSettings.animation.durationMs}
      />
    );

    const nameElement = (
      <span
        key="label"
        className="font-bold text-[14px] pointer-events-none select-none leading-none text-safe-inline"
        style={textStyle}
      >
        {labelText}
      </span>
    );

    const isHorizontal: boolean =
      counterSettings.align === 'left' || counterSettings.align === 'right';

    const elements: React.ReactNode[] = isHorizontal
      ? counterSettings.align === 'left'
        ? [counterElement, nameElement]
        : [nameElement, counterElement]
      : counterSettings.align === 'top'
      ? [counterElement, nameElement]
      : [nameElement, counterElement];

    const alignMode: string = counterSettings.alignMode || 'center';
    const isBetween: boolean = alignMode === 'between';
    const containerClass: string = `flex ${
      isHorizontal ? '' : 'flex-col'
    } w-full h-full items-center pointer-events-none select-none`;

    return (
      <div
        className={containerClass}
        style={{
          justifyContent: isBetween ? 'space-between' : 'center',
          padding: isBetween
            ? isHorizontal
              ? `0 ${contentGap}px`
              : `${contentGap}px 0`
            : '0px',
          gap: isBetween ? '0px' : `${contentGap}px`,
        }}
      >
        {elements}
      </div>
    );
  };

  return (
    <div
      className={`absolute ${className || ''}`}
      style={keyStyle}
      data-state={active ? 'active' : 'inactive'}
    >
      {hasCurrentImage ? (
        <img
          src={currentImageSrc!}
          alt=""
          style={imageStyle}
          draggable={false}
        />
      ) : showInsideCounter ? (
        renderInsideLayout()
      ) : (
        <div
          className="flex items-center justify-center h-full font-bold text-safe-inline"
          style={textStyle}
        >
          {labelText}
        </div>
      )}
    </div>
  );
}
