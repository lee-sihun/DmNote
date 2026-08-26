/**
 * Key/StatItem 공통 내부 카운터 레이아웃
 * 카운터와 라벨을 정렬/배치하는 공유 컴포넌트
 */

import React from 'react';
import type { Signal } from '@preact/signals-react';
import CountDisplay from './CountDisplay';
import SignalCountDisplay from './SignalCountDisplay';
import KeyLabel from '@components/shared/KeyLabel';
import type { KeyCounterSettings } from '@src/types/key/keys';

// 오버레이는 countSignal(구독 격리), 에디터 프리뷰는 count(숫자) — 타입으로 둘 중 하나만 허용.
// 한 마운트에서 경로가 바뀌면 CountDisplay가 리마운트되어 팝 애니메이션 1회가 유실된다
type CounterSource =
  | { count: number; countSignal?: never }
  | { countSignal: Signal<number>; count?: never };

type InsideCounterLayoutProps = CounterSource & {
  labelText: string;
  textStyle: React.CSSProperties;
  active: boolean;
  counterSettings: KeyCounterSettings;
  useInlineStyles?: boolean;
  /** 라벨 그라데이션 클립 - 인라인 우선 모드 승격분 (변수 모드는 전역 규칙) */
  labelPaintStyle?: React.CSSProperties;
  labelHasGradient?: boolean;
  labelMetricsDep?: string;
};

const InsideCounterLayout = ({
  count,
  countSignal,
  labelText,
  textStyle,
  active,
  counterSettings,
  useInlineStyles = false,
  labelPaintStyle,
  labelHasGradient,
  labelMetricsDep,
}: InsideCounterLayoutProps) => {
  const fillColor = active
    ? counterSettings.fill.active
    : counterSettings.fill.idle;
  const fillGradient = active
    ? counterSettings.fillActiveGradient
    : counterSettings.fillIdleGradient;
  const contentGap = Number.isFinite(counterSettings.gap)
    ? counterSettings.gap
    : 4;

  const counterProps = {
    fillColor,
    fillGradient,
    active,
    fontSize: counterSettings.fontSize,
    fontFamily: counterSettings.fontFamily,
    fontWeight: counterSettings.fontWeight,
    fontBold: counterSettings.fontBold,
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
    <KeyLabel
      key="label"
      text={labelText}
      className="font-bold text-[14px] pointer-events-none select-none leading-normal"
      style={textStyle}
      paintStyle={labelPaintStyle}
      hasGradient={labelHasGradient}
      metricsDep={labelMetricsDep}
    />
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
