/**
 * Key/StatItem 공통 내부 카운터 레이아웃
 * 카운터와 라벨을 정렬/배치하는 공유 컴포넌트
 */

import React from 'react';
import type { Signal } from '@preact/signals-react';
import CountDisplay from './CountDisplay';
import SignalCountDisplay from './SignalCountDisplay';
import type { KeyCounterSettings } from '@src/types/key/keys';

interface InsideCounterLayoutProps {
  // 오버레이는 countSignal(구독 격리), 에디터 프리뷰는 count(숫자) — 호출부는 둘 중 하나로 고정.
  // 한 마운트에서 경로가 바뀌면 CountDisplay가 리마운트되어 팝 애니메이션 1회가 유실된다
  count?: number;
  countSignal?: Signal<number>;
  labelText: string;
  textStyle: React.CSSProperties;
  active: boolean;
  counterSettings: KeyCounterSettings;
  useInlineStyles?: boolean;
}

const InsideCounterLayout = ({
  count,
  countSignal,
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

  const counterProps = {
    fillColor,
    fillGradient,
    strokeColor,
    active,
    fontSize: counterSettings.fontSize,
    fontFamily: counterSettings.fontFamily,
    fontWeight: counterSettings.fontWeight,
    fontItalic: counterSettings.fontItalic,
    fontUnderline: counterSettings.fontUnderline,
    fontStrikethrough: counterSettings.fontStrikethrough,
    animationEnabled: counterSettings.animation.enabled,
    animationBezier: counterSettings.animation.bezier,
    animationScale: counterSettings.animation.scale,
    animationDurationMs: counterSettings.animation.durationMs,
    useInlineStyles,
  };

  // 이 파일은 컴파일 대상 — 시그널 .value를 여기서 읽지 말 것 (SignalCountDisplay가 구독)
  const counterElement = countSignal ? (
    <SignalCountDisplay
      key="counter"
      countSignal={countSignal}
      {...counterProps}
    />
  ) : (
    <CountDisplay key="counter" count={count ?? 0} {...counterProps} />
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
