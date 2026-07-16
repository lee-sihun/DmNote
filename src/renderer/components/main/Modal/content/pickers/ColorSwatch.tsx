import React, { forwardRef } from 'react';

export const CHECKER_PATTERN = 'var(--ui-checker-pattern)';
export const CHECKER_SIZE = 'var(--ui-checker-size)';

export interface ColorSwatchGradient {
  top: string;
  bottom: string;
}

interface GradientOpacity {
  top: number;
  bottom: number;
}

type ColorSwatchOpacity = number | GradientOpacity;

interface ColorSwatchSurfaceProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'color'> {
  color?: string | null;
  gradient?: ColorSwatchGradient | null;
  opacity?: ColorSwatchOpacity;
}

interface ColorSwatchButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'color'> {
  color?: string | null;
  gradient?: ColorSwatchGradient | null;
  opacity?: ColorSwatchOpacity;
  open?: boolean;
  selected?: boolean;
  surfaceClassName?: string;
}

const clampOpacity = (value: number): number => Math.min(1, Math.max(0, value));

const colorWithOpacity = (color: string, opacity: number): string => {
  const percentage = clampOpacity(opacity) * 100;
  return `color-mix(in srgb, ${color} ${percentage}%, transparent)`;
};

export const ColorSwatchSurface = ({
  color = 'transparent',
  gradient,
  opacity,
  className = '',
  style,
  ...props
}: ColorSwatchSurfaceProps) => {
  const gradientOpacity =
    gradient && typeof opacity === 'object' ? opacity : null;
  const colorLayerStyle: React.CSSProperties = gradient
    ? {
        background: `linear-gradient(to bottom, ${
          gradientOpacity
            ? colorWithOpacity(gradient.top, gradientOpacity.top)
            : gradient.top
        }, ${
          gradientOpacity
            ? colorWithOpacity(gradient.bottom, gradientOpacity.bottom)
            : gradient.bottom
        })`,
        opacity:
          typeof opacity === 'number' ? clampOpacity(opacity) : undefined,
      }
    : {
        backgroundColor: color ?? 'transparent',
        opacity:
          typeof opacity === 'number' ? clampOpacity(opacity) : undefined,
      };

  // position 클래스는 호출부가 소유 — 기본 relative를 깔면 absolute 칩과
  // 스타일시트 순서 경합이 생김 (position ≠ static이면 내부 레이어 기준 성립)
  return (
    <div className={`overflow-hidden ${className}`} style={style} {...props}>
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          borderRadius: 'inherit',
          background: `${CHECKER_PATTERN} center / var(--ui-checker-size-sm) var(--ui-checker-size-sm) repeat`,
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{ borderRadius: 'inherit', ...colorLayerStyle }}
      />
      <div
        className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_1px_var(--ui-line)]"
        style={{ borderRadius: 'inherit' }}
      />
    </div>
  );
};

export const ColorSwatchButton = forwardRef<
  HTMLButtonElement,
  ColorSwatchButtonProps
>(
  (
    {
      color,
      gradient,
      opacity,
      open = false,
      selected = false,
      surfaceClassName = '',
      className = '',
      type = 'button',
      ...props
    },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        type={type}
        className={`relative p-0 ${
          open || selected ? 'shadow-focus-ring' : ''
        } ${className}`}
        {...props}
      >
        <ColorSwatchSurface
          color={color}
          gradient={gradient}
          opacity={opacity}
          className={`relative w-full h-full ${surfaceClassName}`}
        />
      </button>
    );
  },
);

ColorSwatchButton.displayName = 'ColorSwatchButton';
