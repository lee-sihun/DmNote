'use no memo';
import React from 'react';
import { useSignals } from '@preact/signals-react/runtime';
import { getStatValueSignal } from '@stores/signals/statsSignals';
import type { StatItemType } from '@src/types/key/statItems';
import OutsideCounter from './OutsideCounter';

interface StatPosition {
  dx?: number;
  dy?: number;
  width?: number;
  height?: number;
  hidden?: boolean;
  counter?: unknown;
  className?: string;
  useInlineStyles?: boolean;
  statType: string;
}

interface StatCounterProps {
  position: StatPosition;
  statType: string;
}

interface StatCounterLayerProps {
  positions: StatPosition[];
}

const StatCounter = React.memo(({ position, statType }: StatCounterProps) => {
  useSignals();
  const count = (getStatValueSignal(statType as StatItemType).value ?? 0) | 0;

  return (
    <OutsideCounter
      position={position}
      count={count}
      active={false}
      globalKey={`stat:${statType}`}
    />
  );
});

const StatCounterLayer = React.memo(({ positions }: StatCounterLayerProps) => {
  if (!positions?.length) return null;

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 12 }}
    >
      {positions.map((position, index) => {
        if (!position || position.hidden) return null;
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
});

export default StatCounterLayer;
