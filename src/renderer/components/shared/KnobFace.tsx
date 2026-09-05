import type { CSSProperties } from 'react';
import {
  gradientRingStyle,
  gradientToCss,
  type GradientSpec,
} from '@src/types/color';

interface KnobFaceProps {
  active: boolean;
  useInlineStyles: boolean;
  background: string;
  border: string;
  borderRadius: string;
  shadow: string;
  indicatorColor: string;
  borderGradient?: GradientSpec | null;
  borderWidth: number;
  showBorderRing: boolean;
  imageSrc: string | null;
  imageFit: CSSProperties['objectFit'];
  motionStyle?: CSSProperties;
}

const KnobFace = ({
  active,
  useInlineStyles,
  background,
  border,
  borderRadius,
  shadow,
  indicatorColor,
  borderGradient,
  borderWidth,
  showBorderRing,
  imageSrc,
  imageFit,
  motionStyle,
}: KnobFaceProps) => {
  return (
    <div
      style={
        {
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          position: 'relative',
          ...(useInlineStyles
            ? {
                borderRadius,
                background,
                backgroundClip: 'padding-box',
                border,
                padding: showBorderRing ? `${borderWidth}px` : undefined,
                boxShadow: shadow,
              }
            : {
                '--dmn-knob-bg-default': background,
                '--dmn-knob-border-default': border,
                '--dmn-knob-radius-default': borderRadius,
                '--dmn-knob-padding-default': showBorderRing
                  ? `${borderWidth}px`
                  : '0px',
                '--dmn-knob-shadow-default': shadow,
                '--dmn-knob-indicator-default': indicatorColor,
              }),
          boxSizing: 'border-box',
          ...motionStyle,
        } as CSSProperties
      }
      data-knob-element="true"
      data-knob-state={active ? 'active' : 'inactive'}
    >
      {showBorderRing && borderGradient && (
        <span
          aria-hidden="true"
          data-gradient-border-ring="true"
          style={{
            ...gradientRingStyle(borderGradient, borderWidth),
            ...(useInlineStyles
              ? { background: gradientToCss(borderGradient) }
              : {}),
          }}
        />
      )}
      {imageSrc ? (
        <img
          src={imageSrc}
          alt=""
          draggable={false}
          style={{
            width: '100%',
            height: '100%',
            objectFit: imageFit,
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        />
      ) : (
        <div
          style={{
            position: 'absolute',
            top: '12%',
            left: '50%',
            width: '8%',
            height: '76%',
            transform: 'translateX(-50%)',
            background: useInlineStyles ? indicatorColor : undefined,
            borderRadius: '4px',
          }}
          data-knob-indicator="true"
        />
      )}
    </div>
  );
};

export default KnobFace;
