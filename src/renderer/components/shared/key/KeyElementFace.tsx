import React from 'react';
import KeyLabel from '@components/shared/key/KeyLabel';
import { isErrorForCurrentSrc } from '@hooks/overlay/useFailedImageSrcs';
import type {
  KeyElementPosition,
  KeyElementStyles,
} from '@hooks/overlay/useKeyElementStyles';

interface KeyElementContentProps {
  styles: KeyElementStyles;
  insideContent?: React.ReactNode;
  markImageFailed: (src: string | null | undefined) => void;
}

export const KeyElementContent = ({
  styles,
  insideContent,
  markImageFailed,
}: KeyElementContentProps) => {
  const {
    borderRingStyle,
    imageStyle,
    textStyle,
    labelPaintStyle,
    labelHasGradient,
    labelMetricsDep,
    currentImageSrc,
    hasCurrentImage,
    imageReplaces,
    labelText,
  } = styles;

  return (
    <>
      {borderRingStyle && (
        <span
          aria-hidden="true"
          data-gradient-border-ring="true"
          style={borderRingStyle}
        />
      )}
      {hasCurrentImage && (
        <img
          src={currentImageSrc || ''}
          alt=""
          data-key-image-layer="true"
          style={imageStyle}
          draggable={false}
          onError={(event) => {
            if (!isErrorForCurrentSrc(event.currentTarget, currentImageSrc))
              return;
            markImageFailed(currentImageSrc);
          }}
        />
      )}
      {imageReplaces ? null : insideContent !== undefined ? (
        insideContent
      ) : (
        <div
          className="flex items-center justify-center h-full font-bold"
          style={textStyle}
        >
          <KeyLabel
            text={labelText}
            paintStyle={labelPaintStyle}
            hasGradient={labelHasGradient}
            metricsDep={labelMetricsDep}
          />
        </div>
      )}
    </>
  );
};

interface OverlayKeyElementFaceProps {
  position: KeyElementPosition;
  active: boolean;
  styles: KeyElementStyles;
  insideContent?: React.ReactNode;
  markImageFailed: (src: string | null | undefined) => void;
}

export const OverlayKeyElementFace = ({
  position,
  active,
  styles,
  insideContent,
  markImageFailed,
}: OverlayKeyElementFaceProps) => {
  if (styles.isTransparent) {
    return (
      <div
        aria-hidden="true"
        className={`absolute ${position.className || ''}`}
        style={{
          ...styles.keyStyle,
          visibility: 'hidden',
          pointerEvents: 'none',
        }}
        data-overlay-hit="true"
        data-overlay-hit-only="true"
      />
    );
  }

  return (
    <div
      className={`absolute ${position.className || ''}`}
      style={styles.keyStyle}
      data-state={active ? 'active' : 'inactive'}
      data-key-element="true"
      data-overlay-hit="true"
      data-key-image={styles.hasCurrentImage ? 'true' : undefined}
      data-key-image-mode={
        styles.hasCurrentImage ? styles.imageMode : undefined
      }
    >
      <KeyElementContent
        styles={styles}
        insideContent={insideContent}
        markImageFailed={markImageFailed}
      />
    </div>
  );
};
