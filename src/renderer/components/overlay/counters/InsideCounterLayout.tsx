/**
 * Key/StatItem 공통 내부 카운터 레이아웃
 * 카운터와 라벨을 정렬/배치하는 공유 컴포넌트
 */

import React from 'react';
import CountDisplay from './CountDisplay';
import type { KeyCounterSettings } from '@src/types/key/keys';

interface InsideCounterLayoutProps {
  count: number;
  labelText: string;
  textStyle: React.CSSProperties;
  active: boolean;
  counterSettings: KeyCounterSettings;
  useInlineStyles?: boolean;
}

const InsideCounterLayout = ({
  count,
  labelText,
  textStyle,
  active,
  counterSettings,
  useInlineStyles = false,
}: InsideCounterLayoutProps) => {
  const fillColor = active
    ? counterSettings.fill.active
    : counterSettings.fill.idle;
  const fillGradient = active
    ? counterSettings.fillActiveGradient
    : counterSettings.fillIdleGradient;
  const strokeColor = active
    ? counterSettings.stroke.active
    : counterSettings.stroke.idle;
  const contentGap = Number.isFinite(counterSettings.gap)
    ? counterSettings.gap
    : 4;

  const counterElement = (
    <CountDisplay
      key="counter"
      count={count}
      fillColor={fillColor}
      fillGradient={fillGradient}
      strokeColor={strokeColor}
      active={active}
      fontSize={counterSettings.fontSize}
      fontFamily={counterSettings.fontFamily}
      fontWeight={counterSettings.fontWeight}
      fontBold={counterSettings.fontBold}
      fontItalic={counterSettings.fontItalic}
      fontUnderline={counterSettings.fontUnderline}
      fontStrikethrough={counterSettings.fontStrikethrough}
      animationEnabled={counterSettings.animation.enabled}
      animationBezier={counterSettings.animation.bezier}
      animationScale={counterSettings.animation.scale}
      animationDurationMs={counterSettings.animation.durationMs}
      useInlineStyles={useInlineStyles}
    />
  );

  const nameElement = (
    <span
      key="label"
      className="font-bold text-[14px] pointer-events-none select-none leading-normal text-safe-inline"
      style={textStyle}
    >
      {labelText}
    </span>
  );

  const isHorizontal =
    counterSettings.align === 'left' || counterSettings.align === 'right';

  const elements = isHorizontal
    ? counterSettings.align === 'left'
      ? [counterElement, nameElement]
      : [nameElement, counterElement]
    : counterSettings.align === 'top'
    ? [counterElement, nameElement]
    : [nameElement, counterElement];

  const alignMode = counterSettings.alignMode || 'center';
  const isBetween = alignMode === 'between';
  const containerClass = `flex ${
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

export default InsideCounterLayout;
