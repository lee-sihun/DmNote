import React, { memo } from 'react';
import { useSignals } from '@preact/signals-react/runtime';
import { getKeyCounterSignal } from '@stores/signals/keyCounterSignals';
import CountDisplay from '@components/overlay/counters/CountDisplay';
import { getKeySignal } from '@stores/signals/keySignals';
import {
  useCounterSettings,
  computeOutsideStyle,
} from '@hooks/shared/useCounterSettings';

interface KeyPosition {
  dx?: number;
  dy?: number;
  width?: number;
  height?: number;
  hidden?: boolean;
  counter?: unknown;
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


const KeyCounter = memo(({ globalKey, position, mode }: KeyCounterProps) => {
  useSignals();
  const counterSignal = getKeyCounterSignal(mode ?? '', globalKey);
  const count = counterSignal?.value ?? 0;
  const active = getKeySignal(globalKey).value;

  const dx = Number.isFinite(position?.dx) ? position.dx : 0;
  const dy = Number.isFinite(position?.dy) ? position.dy : 0;
  const width = Number.isFinite(position?.width) ? position.width : 0;
  const height = Number.isFinite(position?.height) ? position.height : 0;
  const counterSettings = useCounterSettings(position?.counter);

  // 개별 키의 카운터가 비활성화되었거나 outside가 아니면 렌더링하지 않음
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
  const strokeColor = active
    ? counterSettings.stroke.active
    : counterSettings.stroke.idle;
  return (
    <div className="pointer-events-none" style={style}>
      <CountDisplay
        count={count}
        fillColor={fillColor}
        strokeColor={strokeColor}
        globalKey={globalKey}
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
    </div>
  );
});

export default function KeyCounterLayer({ keys, positions, mode }: KeyCounterLayerProps) {
  if (!keys?.length || !positions?.length) {
    return null;
  }

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 12 }}
    >
      {keys.map((key: string, index: number) => {
        const position = positions[index];
        if (!position) return null;
        if (position.hidden) return null;
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
}
