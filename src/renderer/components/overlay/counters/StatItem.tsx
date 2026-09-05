'use no memo';
import React, { useEffect } from 'react';
import { useSignals } from '@preact/signals-react/runtime';
import { getStatValueSignal } from '@stores/signals/statsSignals';
import type { StatItemType } from '@src/types/key/statItems';
import { useCounterSettings } from '@hooks/overlay/useCounterSettings';
import { useFailedImageSrcs } from '@hooks/overlay/useFailedImageSrcs';
import {
  computeKeyElementStyles,
  type KeyElementPosition,
} from '@hooks/overlay/useKeyElementStyles';
import { warmupImageSource } from '@utils/media/imageWarmup';
import InsideCounterLayout from './InsideCounterLayout';
import { OverlayKeyElementFace } from '@components/shared/KeyElementFace';

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
    const styles = computeKeyElementStyles({
      position,
      active,
      label: label || '',
      failedImageSrcs,
    });
    const {
      textStyle,
      inactiveImageSrc,
      activeImageSrc,
      labelText,
      labelPaintStyle,
      labelHasGradient,
      labelMetricsDep,
    } = styles;

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
    if (styles.isTransparent) {
      return (
        <OverlayKeyElementFace
          position={position}
          active={active}
          styles={styles}
          markImageFailed={markFailed}
        />
      );
    }

    const insideContent =
      showInsideCounter && counterSignal ? (
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
      ) : undefined;

    return (
      <OverlayKeyElementFace
        position={position}
        active={active}
        styles={styles}
        insideContent={insideContent}
        markImageFailed={markFailed}
      />
    );
  },
);

export default StatItem;
