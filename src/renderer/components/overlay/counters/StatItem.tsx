'use no memo';
import React, { useEffect } from 'react';
import { useSignals } from '@preact/signals-react/runtime';
import { getStatValueSignal } from '@stores/signals/statsSignals';
import type { StatItemType } from '@src/types/key/statItems';
import { useCounterSettings } from '@hooks/overlay/useCounterSettings';
import {
  isErrorForCurrentSrc,
  useFailedImageSrcs,
} from '@hooks/overlay/useFailedImageSrcs';
import {
  computeKeyElementStyles,
  type KeyElementPosition,
} from '@hooks/overlay/useKeyElementStyles';
import { warmupImageSource } from '@utils/core/imageWarmup';
import InsideCounterLayout from './InsideCounterLayout';
import KeyLabel from '@components/shared/KeyLabel';

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

    const { failedImageSrcs, markFailed } = useFailedImageSrcs(
      position?.inactiveImage,
      position?.activeImage,
    );
    const {
      keyStyle,
      borderRingStyle,
      imageStyle,
      textStyle,
      inactiveImageSrc,
      activeImageSrc,
      currentImageSrc,
      hasCurrentImage,
      imageMode,
      imageReplaces,
      isTransparent,
      labelText,
      labelPaintStyle,
      labelHasGradient,
      labelMetricsDep,
    } = computeKeyElementStyles({
      position,
      active,
      label: label || '',
      failedImageSrcs,
    });

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

    if (position?.hidden) return null;

    if (isTransparent) {
      return (
        <div
          aria-hidden="true"
          className={`absolute ${position.className || ''}`}
          style={{ ...keyStyle, visibility: 'hidden', pointerEvents: 'none' }}
          data-overlay-hit="true"
          data-overlay-hit-only="true"
        />
      );
    }

    return (
      <div
        className={`absolute ${position.className || ''}`}
        style={keyStyle}
        data-state={active ? 'active' : 'inactive'}
        data-key-element="true"
        data-overlay-hit="true"
        data-key-image={hasCurrentImage ? 'true' : undefined}
        data-key-image-mode={hasCurrentImage ? imageMode : undefined}
      >
        {borderRingStyle && (
          <span
            aria-hidden="true"
            data-gradient-border-ring="true"
            style={borderRingStyle}
          />
        )}
        {hasCurrentImage && (
          <img
            src={currentImageSrc!}
            alt=""
            data-key-image-layer="true"
            style={imageStyle}
            draggable={false}
            onError={(event) => {
              if (!isErrorForCurrentSrc(event.currentTarget, currentImageSrc))
                return;
              markFailed(currentImageSrc);
            }}
          />
        )}
        {imageReplaces ? null : showInsideCounter && counterSignal ? (
          <InsideCounterLayout
            countSignal={counterSignal}
            labelText={labelText}
            textStyle={textStyle}
            active={active}
            counterSettings={counterSettings}
            useInlineStyles={position.useInlineStyles === true}
            labelPaintStyle={labelPaintStyle}
            labelHasGradient={labelHasGradient}
            labelMetricsDep={labelMetricsDep}
          />
        ) : (
          <div
            className="flex items-center justify-center h-full font-bold"
            style={textStyle}
          >
            {/* 라벨 페인트는 내용 크기 span 기준 - 키 라벨과 같은 박스 계약 */}
            <KeyLabel
              text={labelText}
              paintStyle={labelPaintStyle}
              hasGradient={labelHasGradient}
              metricsDep={labelMetricsDep}
            />
          </div>
        )}
      </div>
    );
  },
);

export default StatItem;
