/**
 * Key/Stat 공통 외부 카운터 컴포넌트
 * counterSettings에 따라 outside 위치에 카운터를 렌더링
 */

import React from 'react';
import CountDisplay from './CountDisplay';
import {
  useCounterSettings,
  computeOutsideStyle,
} from '@hooks/overlay/useCounterSettings';

interface OutsideCounterProps {
  position: {
    dx?: number;
    dy?: number;
    width?: number;
    height?: number;
    counter?: unknown;
    className?: string;
    useInlineStyles?: boolean;
  };
  count: number;
  active: boolean;
  globalKey?: string;
}

const OutsideCounter = ({
  position,
  count,
  active,
  globalKey,
}: OutsideCounterProps) => {
  const dx = Number.isFinite(position?.dx) ? position.dx! : 0;
  const dy = Number.isFinite(position?.dy) ? position.dy! : 0;
  const width = Number.isFinite(position?.width) ? position.width! : 0;
  const height = Number.isFinite(position?.height) ? position.height! : 0;

  const counterSettings = useCounterSettings(position?.counter);

  if (!counterSettings.enabled || counterSettings.placement !== 'outside') {
    return null;
  }

  const style = computeOutsideStyle(
    counterSettings.align,
    dx,
    dy,
    width,
    height,
    counterSettings.gap,
  );

  const fillColor = active
    ? counterSettings.fill.active
    : counterSettings.fill.idle;
  const fillGradient = active
    ? counterSettings.fillActiveGradient
    : counterSettings.fillIdleGradient;
  const strokeColor = active
    ? counterSettings.stroke.active
    : counterSettings.stroke.idle;

  return (
    <div
      className={`pointer-events-none ${position.className || ''}`}
      style={style}
    >
      <CountDisplay
        count={count}
        fillColor={fillColor}
        fillGradient={fillGradient}
        strokeColor={strokeColor}
        globalKey={globalKey}
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
        useInlineStyles={position.useInlineStyles === true}
      />
    </div>
  );
};

export default OutsideCounter;
