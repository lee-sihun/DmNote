'use no memo';
import React, { useEffect } from 'react';
import { useSignals } from '@preact/signals-react/runtime';
import { getStatValueSignal } from '@stores/signals/statsSignals';
import type { StatItemType } from '@src/types/key/statItems';
import { useCounterSettings } from '@hooks/overlay/useCounterSettings';
import {
  computeKeyElementStyles,
  type KeyElementPosition,
} from '@hooks/overlay/useKeyElementStyles';
import { warmupImageSource } from '@utils/core/imageWarmup';
import InsideCounterLayout from './InsideCounterLayout';

interface StatItemProps {
  statType: string;
  position: KeyElementPosition;
  label?: string;
  counterEnabled?: boolean;
  active?: boolean;
}

const StatItem = React.memo(({
  statType,
  position,
  label,
  counterEnabled = false,
  active = false,
}: StatItemProps) => {
  useSignals();

  const {
    keyStyle,
    imageStyle,
    textStyle,
    inactiveImageSrc,
    activeImageSrc,
    currentImageSrc,
    hasCurrentImage,
    isTransparent,
    labelText,
  } = computeKeyElementStyles({ position, active, label: label || '' });

  // 이미지 프리로드
  useEffect(() => {
    warmupImageSource(inactiveImageSrc);
    warmupImageSource(activeImageSrc);
  }, [inactiveImageSrc, activeImageSrc]);

  const counterSettings = useCounterSettings(position.counter);
  const showInsideCounter =
    counterEnabled &&
    counterSettings.enabled &&
    counterSettings.placement === 'inside';

  const counterValue = showInsideCounter
    ? (getStatValueSignal(statType as StatItemType).value ?? 0) | 0
    : 0;

  if (position?.hidden || isTransparent) return null;

  return (
    <div
      className={`absolute ${position.className || ''}`}
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
        <InsideCounterLayout
          count={counterValue}
          labelText={labelText}
          textStyle={textStyle}
          active={active}
          counterSettings={counterSettings}
        />
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
});

export default StatItem;
