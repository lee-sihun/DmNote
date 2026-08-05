'use no memo';
import React from 'react';
import { useSignals } from '@preact/signals-react/runtime';
import { getKeyCounterSignal } from '@stores/signals/keyCounterSignals';
import { getKeySignal } from '@stores/signals/keySignals';
import OutsideCounter from './OutsideCounter';

interface KeyPosition {
  dx?: number;
  dy?: number;
  width?: number;
  height?: number;
  hidden?: boolean;
  counter?: unknown;
  className?: string;
  useInlineStyles?: boolean;
}

interface KeyCounterProps {
  globalKey: string;
  position: KeyPosition;
  mode: string;
}

interface KeyCounterLayerProps {
  keys: string[];
  positions: KeyPosition[];
  mode: string;
}

const KeyCounter = React.memo(
  ({ globalKey, position, mode }: KeyCounterProps) => {
    useSignals();
    const counterSignal = getKeyCounterSignal(mode ?? '', globalKey);
    const count = counterSignal?.value ?? 0;
    const active = getKeySignal(globalKey).value;

    return (
      <OutsideCounter
        position={position}
        count={count}
        active={active}
        globalKey={globalKey}
      />
    );
  },
);

const KeyCounterLayer = React.memo(
  ({ keys, positions, mode }: KeyCounterLayerProps) => {
    if (!keys?.length || !positions?.length) return null;

    return (
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ zIndex: 12 }}
      >
        {keys.map((key: string, index: number) => {
          const position = positions[index];
          if (!position || position.hidden) return null;
          return (
            <KeyCounter
              key={`${mode}-${key}-${index}`}
              globalKey={key}
              position={position}
              mode={mode}
            />
          );
        })}
      </div>
    );
  },
);

export default KeyCounterLayer;
