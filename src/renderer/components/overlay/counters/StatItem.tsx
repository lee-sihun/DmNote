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

const StatItem = React.memo(
  ({
    statType,
    position,
    label,
    counterEnabled = false,
    active = false,
  }: StatItemProps) => {
    useSignals();

    const {
      keyStyle,
      borderRingStyle,
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

    // 시그널 객체만 넘기고 .value는 읽지 않음 — KPS 틱/press마다 StatItem 전체가 리렌더되지 않도록
    const counterSignal = showInsideCounter
      ? getStatValueSignal(statType as StatItemType)
      : undefined;

    if (position?.hidden || isTransparent) return null;

    return (
      <div
        className={`absolute ${position.className || ''}`}
        style={keyStyle}
        data-state={active ? 'active' : 'inactive'}
        data-key-element="true"
        data-key-image={hasCurrentImage ? 'true' : undefined}
      >
        {borderRingStyle && (
          <span
            aria-hidden="true"
            data-gradient-border-ring="true"
            style={borderRingStyle}
          />
        )}
        {hasCurrentImage ? (
          <img
            src={currentImageSrc!}
            alt=""
            style={imageStyle}
            draggable={false}
          />
        ) : showInsideCounter && counterSignal ? (
          <InsideCounterLayout
            countSignal={counterSignal}
            labelText={labelText}
            textStyle={textStyle}
            active={active}
            counterSettings={counterSettings}
            useInlineStyles={position.useInlineStyles === true}
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
  },
);

export default StatItem;
