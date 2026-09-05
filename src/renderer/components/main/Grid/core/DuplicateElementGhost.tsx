import type { CSSProperties } from 'react';

import type { DuplicateState } from '@hooks/Grid/useGridCanvasActions';
import { resolveImageSource } from '@utils/core/imageSource';
import {
  DEFAULT_IMAGE_MODE,
  imageTransformToCss,
} from '@src/types/key/imageLayer';
import {
  DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
  DEFAULT_ELEMENT_BG,
  DEFAULT_ELEMENT_FONT,
  DEFAULT_ELEMENT_RADIUS,
  DEFAULT_ELEMENT_SHADOW_SPEC,
} from '@utils/core/elementDefaults';
import { resolveElementBorder } from '@utils/core/elementBorder';
import { gradientRingStyle, gradientToCss } from '@src/types/color';
import {
  elementShadowToCss,
  resolveElementShadow,
} from '@src/types/key/shadows';

interface DuplicateElementGhostProps {
  duplicate: DuplicateState | null;
  cursor: { x: number; y: number } | null;
}

const GhostBorderRing = ({ suppressDefault }: { suppressDefault: boolean }) => {
  const border = resolveElementBorder({}, false, { suppressDefault });
  if (!border.gradient || border.width <= 0) return null;
  return (
    <span
      aria-hidden="true"
      style={{
        ...gradientRingStyle(border.gradient, border.width),
        background: gradientToCss(border.gradient),
        pointerEvents: 'none',
      }}
    />
  );
};

const DuplicateElementGhost = ({
  duplicate,
  cursor,
}: DuplicateElementGhostProps) => {
  if (!duplicate || !cursor) return null;

  if (duplicate.elementType === 'graph') {
    const width = duplicate.position?.width || 200;
    const height = duplicate.position?.height || 100;
    const offsetX = cursor.x - width / 2;
    const offsetY = cursor.y - height / 2;
    return (
      <div
        className="absolute pointer-events-none select-none"
        style={{
          width: `${width}px`,
          height: `${height}px`,
          transform: `translate3d(${offsetX}px, ${offsetY}px, 0)`,
          background: DEFAULT_ELEMENT_BG,
          border: 'none',
          borderRadius: `${DEFAULT_ELEMENT_RADIUS}px`,
          overflow: 'hidden',
          opacity: 0.5,
          zIndex: 'var(--z-canvas-drag-preview)',
        }}
      >
        <GhostBorderRing suppressDefault={false} />
      </div>
    );
  }

  const {
    position: {
      width = 60,
      height = 60,
      inactiveImage,
      activeImage,
      imageFit,
      idleImageFit,
      imageMode,
      idleImageTransform,
      className,
      shadow,
      activeShadow,
    },
    keyName,
  } = duplicate;
  const previewImage =
    resolveImageSource(inactiveImage) || resolveImageSource(activeImage) || '';
  const ghostImageReplaces =
    Boolean(previewImage) && (imageMode ?? DEFAULT_IMAGE_MODE) === 'replace';
  const backgroundColor = ghostImageReplaces
    ? 'transparent'
    : DEFAULT_ELEMENT_BG;
  const previewShadow = elementShadowToCss(
    resolveElementShadow({
      active: false,
      shadow,
      activeShadow,
      defaultShadow: DEFAULT_ELEMENT_SHADOW_SPEC,
      defaultActiveShadow: DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
      suppressDefault: ghostImageReplaces,
    }),
  );
  const offsetX = cursor.x - width / 2;
  const offsetY = cursor.y - height / 2;

  return (
    <div
      className={`absolute pointer-events-none select-none ${className || ''}`}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate3d(${offsetX}px, ${offsetY}px, 0)`,
        backgroundColor,
        borderRadius: `${DEFAULT_ELEMENT_RADIUS}px`,
        border: 'none',
        boxShadow: previewShadow,
        overflow: ghostImageReplaces ? 'hidden' : 'visible',
        opacity: 0.5,
        zIndex: 'var(--z-canvas-drag-preview)',
      }}
    >
      <GhostBorderRing suppressDefault={ghostImageReplaces} />
      {previewImage ? (
        <img
          src={previewImage}
          alt=""
          style={{
            width: '100%',
            height: '100%',
            objectFit: (idleImageFit ||
              imageFit ||
              'cover') as CSSProperties['objectFit'],
            transform: idleImageTransform
              ? imageTransformToCss(idleImageTransform)
              : undefined,
            display: 'block',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
          draggable={false}
        />
      ) : (
        <div
          className="flex items-center justify-center h-full font-bold leading-none text-safe-inline"
          style={{
            color: `var(--key-text-color, ${DEFAULT_ELEMENT_FONT})`,
            willChange: 'auto',
            contain: 'layout style paint',
          }}
        >
          {keyName || ''}
        </div>
      )}
    </div>
  );
};

export default DuplicateElementGhost;
