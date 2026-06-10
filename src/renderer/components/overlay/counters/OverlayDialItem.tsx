'use no memo';
import React from 'react';
import { useSignals } from '@preact/signals-react/runtime';
import { getAxisSignal } from '@stores/signals/axisSignals';
import { resolveImageSource } from '@utils/core/imageSource';

interface DialPosition {
  hidden?: boolean;
  axisId?: string;
  sensitivity?: number;
  reverse?: boolean;
  dx?: number;
  dy?: number;
  width?: number;
  height?: number;
  className?: string;
  zIndex?: number;
  activeImage?: string;
  inactiveImage?: string;
  idleTransparent?: boolean;
  imageFit?: string;
  idleImageFit?: string;
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
}

interface OverlayDialItemProps {
  position: DialPosition;
  index?: number;
}

// HID 축(노브)에 바인딩되는 회전 요소. axisSignals의 누적 wrap-델타에
// 민감도/방향을 적용해 회전. 입력 사이 보간은 CSS transition으로 처리.
const OverlayDialItem = ({ position, index = 0 }: OverlayDialItemProps) => {
  useSignals();

  const {
    axisId = '',
    sensitivity = 1.40625,
    reverse = false,
    dx = 0,
    dy = 0,
    width = 80,
    height = 80,
    className,
    activeImage,
    inactiveImage,
    idleTransparent = false,
    imageFit,
    idleImageFit,
    backgroundColor,
    borderColor,
    borderWidth,
  } = position ?? {};

  if (!position || position.hidden) return null;

  const accum = axisId ? getAxisSignal(axisId).value : 0;
  const angle = accum * sensitivity * (reverse ? -1 : 1);

  const imageSrc =
    resolveImageSource(inactiveImage) ||
    resolveImageSource(activeImage) ||
    null;
  const resolvedFit = (idleImageFit ||
    imageFit ||
    'cover') as React.CSSProperties['objectFit'];

  const transform = `translate3d(calc(${dx}px + var(--key-offset-x, 0px)), calc(${dy}px + var(--key-offset-y, 0px)), 0)`;

  return (
    <div
      className={`absolute select-none ${className || ''}`}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        transform,
        zIndex: position.zIndex ?? index,
        contain: 'layout style paint',
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          borderRadius: '50%',
          overflow: 'hidden',
          position: 'relative',
          background: idleTransparent
            ? 'transparent'
            : backgroundColor || 'rgba(17, 17, 20, 0.6)',
          border:
            borderWidth && borderWidth > 0
              ? `${borderWidth}px solid ${
                  borderColor || 'rgba(255, 255, 255, 0.25)'
                }`
              : undefined,
          boxSizing: 'border-box',
          transform: `rotate(${angle}deg)`,
          transition: 'transform 0.1s linear',
          willChange: 'transform',
          backfaceVisibility: 'hidden',
        }}
      >
        {imageSrc ? (
          <img
            src={imageSrc}
            alt=""
            draggable={false}
            style={{
              width: '100%',
              height: '100%',
              objectFit: resolvedFit,
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          />
        ) : (
          // 기본 원형 + 회전 인식용 중앙 일자 막대
          <div
            style={{
              position: 'absolute',
              top: '12%',
              left: '50%',
              width: '8%',
              height: '76%',
              transform: 'translateX(-50%)',
              background: borderColor || 'rgba(255, 255, 255, 0.85)',
              borderRadius: '4px',
            }}
          />
        )}
      </div>
    </div>
  );
};

export default OverlayDialItem;
