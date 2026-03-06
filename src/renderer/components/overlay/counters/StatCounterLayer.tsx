import React, { memo } from 'react';
import { useSignals } from '@preact/signals-react/runtime';
import { getStatValueSignal } from '@stores/signals/statsSignals';
import type { StatItemType } from '@src/types/statItems';
import CountDisplay from '@components/overlay/counters/CountDisplay';
import {
  useCounterSettings,
  computeOutsideStyle,
} from '@hooks/shared/useCounterSettings';

interface StatPosition {
  dx?: number;
  dy?: number;
  width?: number;
  height?: number;
  hidden?: boolean;
  counter?: unknown;
  statType: string;
}

interface StatCounterProps {
  position: StatPosition;
  statType: string;
}

interface StatCounterLayerProps {
  positions: StatPosition[];
}

const StatCounter = memo(({ position, statType }: StatCounterProps) => {
  useSignals();

  const dx = Number.isFinite(position?.dx) ? position.dx! : 0;
  const dy = Number.isFinite(position?.dy) ? position.dy! : 0;
  const width = Number.isFinite(position?.width) ? position.width! : 0;
  const height = Number.isFinite(position?.height) ? position.height! : 0;

  const counterSettings = useCounterSettings(position?.counter);

  if (!counterSettings.enabled || counterSettings.placement !== 'outside') {
    return null;
  }

  const count = (getStatValueSignal(statType as StatItemType).value ?? 0) | 0;

  const style = computeOutsideStyle(
    counterSettings.align,
    dx,
    dy,
    width,
    height,
    counterSettings.gap,
  );

  const fillColor = counterSettings.fill.idle;
  const strokeColor = counterSettings.stroke.idle;
  return (
    <div className="pointer-events-none" style={style}>
      <CountDisplay
        count={count}
        fillColor={fillColor}
        strokeColor={strokeColor}
        globalKey={`stat:${statType}`}
        active={false}
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
    </div>
  );
});

export default function StatCounterLayer({ positions }: StatCounterLayerProps) {
  if (!positions?.length) {
    return null;
  }

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 12 }}
    >
      {positions.map((position, index) => {
        if (!position) return null;
        if (position.hidden) return null;
        return (
          <StatCounter
            key={`stat-counter-${index}`}
            position={position}
            statType={position.statType}
          />
        );
      })}
    </div>
  );
}
