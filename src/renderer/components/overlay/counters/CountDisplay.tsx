import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toCssRgba } from '@utils/color/colorUtils';
import {
  COUNTER_DEFAULT_BEZIER,
  createCubicBezierEasing,
} from '@utils/cubicBezier';

interface CountDisplayProps {
  count: number;
  fillColor?: string;
  strokeColor?: string;
  globalKey?: string;
  active?: boolean;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: number;
  fontItalic?: boolean;
  fontUnderline?: boolean;
  fontStrikethrough?: boolean;
  animationEnabled?: boolean;
  animationBezier?: [number, number, number, number];
  animationScale?: number;
  animationDurationMs?: number;
}

const CountDisplay = ({
  count,
  fillColor,
  strokeColor,
  globalKey: _globalKey,
  active,
  fontSize,
  fontFamily,
  fontWeight,
  fontItalic,
  fontUnderline,
  fontStrikethrough,
  animationEnabled = true,
  animationBezier = COUNTER_DEFAULT_BEZIER,
  animationScale = 1.1,
  animationDurationMs = 300,
}: CountDisplayProps) => {
  const [scale, setScale] = useState<number>(1);
  const scaleRef = useRef<number>(1);
  const prevCount = useRef<number>(count);
  const animationRef = useRef<number | null>(null);
  const targetScale = Number.isFinite(Number(animationScale))
    ? Number(animationScale)
    : 1.1;
  const durationMs = Math.min(
    Math.max(Math.round(Number(animationDurationMs) || 300), 1),
    5000,
  );
  const b0 = animationBezier?.[0];
  const b1 = animationBezier?.[1];
  const b2 = animationBezier?.[2];
  const b3 = animationBezier?.[3];
  const easing = useMemo(
    () => createCubicBezierEasing(animationBezier),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [b0, b1, b2, b3],
  );

  useEffect(() => {
    if (!animationEnabled) {
      prevCount.current = count;
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      if (scaleRef.current !== 1) {
        scaleRef.current = 1;
        setScale(1);
      }
      return;
    }

    if (prevCount.current !== count) {
      prevCount.current = count;

      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }

      const startTime = performance.now();

      const animate = (timestamp: number) => {
        const elapsed = timestamp - startTime;
        const progress = Math.min(elapsed / durationMs, 1);
        const easedProgress = easing(progress);
        const nextScale = 1 + (targetScale - 1) * (1 - easedProgress);

        if (Math.abs(scaleRef.current - nextScale) > 0.0005) {
          scaleRef.current = nextScale;
          setScale(nextScale);
        }

        if (progress < 1) {
          animationRef.current = requestAnimationFrame(animate);
        } else {
          if (scaleRef.current !== 1) {
            scaleRef.current = 1;
            setScale(1);
          }
          animationRef.current = null;
        }
      };

      animationRef.current = requestAnimationFrame(animate);
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [count, durationMs, easing, targetScale, animationEnabled]);

  const displayValue = count || 0;
  const fill = toCssRgba(fillColor, '#FFFFFF');
  const stroke = toCssRgba(strokeColor, 'transparent');
  const strokeWidth = stroke.alpha > 0 ? '1px' : '0px';

  const textDecorations: string[] = [];
  if (fontUnderline) textDecorations.push('underline');
  if (fontStrikethrough) textDecorations.push('line-through');
  const textDecoration =
    textDecorations.length > 0 ? textDecorations.join(' ') : 'none';

  return (
    <span
      className="counter"
      data-text={displayValue}
      data-counter-state={active ? 'active' : 'inactive'}
      style={
        {
          transform: `scale(${scale})`,
          transformOrigin: 'center bottom',
          fontSize: `${Number.isFinite(fontSize) ? fontSize : 16}px`,
          fontFamily: fontFamily
            ? `"${fontFamily}", "Pretendard Variable", sans-serif`
            : undefined,
          fontWeight: Number.isFinite(fontWeight) ? fontWeight : 400,
          fontStyle: fontItalic ? 'italic' : 'normal',
          textDecoration,
          textAlign: 'center',
          pointerEvents: 'none',
          userSelect: 'none',
          lineHeight: 'normal',
          '--counter-color-default': fill.css,
          '--counter-stroke-color-default': stroke.css,
          '--counter-stroke-width-default': strokeWidth,
        } as React.CSSProperties
      }
    >
      {displayValue}
    </span>
  );
};

export default CountDisplay;
