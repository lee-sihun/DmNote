import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toCssRgba } from '@utils/colorUtils';
import {
  COUNTER_DEFAULT_BEZIER,
  createCubicBezierEasing,
} from '@utils/cubicBezier';

export default function CountDisplay({
  count,
  fillColor,
  strokeColor,
  globalKey,
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
}) {
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(1);
  const prevCount = useRef(count);
  const animationRef = useRef(null);
  const targetScale = Number.isFinite(Number(animationScale))
    ? Number(animationScale)
    : 1.1;
  const durationMs = Math.min(
    Math.max(Math.round(Number(animationDurationMs) || 300), 1),
    5000,
  );
  const easing = useMemo(
    () => createCubicBezierEasing(animationBezier),
    [
      animationBezier?.[0],
      animationBezier?.[1],
      animationBezier?.[2],
      animationBezier?.[3],
    ],
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

      const animate = (timestamp) => {
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

  const textDecorations = [];
  if (fontUnderline) textDecorations.push('underline');
  if (fontStrikethrough) textDecorations.push('line-through');
  const textDecoration =
    textDecorations.length > 0 ? textDecorations.join(' ') : 'none';

  return (
    <span
      className="counter"
      data-text={displayValue}
      data-counter-state={active ? 'active' : 'inactive'}
      style={{
        transform: `scale(${scale})`,
        transformOrigin: 'center bottom',
        fontSize: `${Number.isFinite(fontSize) ? fontSize : 16}px`,
        fontFamily: fontFamily
          ? `"${fontFamily}", "SUIT-Regular", sans-serif`
          : undefined,
        fontWeight: Number.isFinite(fontWeight) ? fontWeight : 400,
        fontStyle: fontItalic ? 'italic' : 'normal',
        textDecoration,
        textAlign: 'center',
        pointerEvents: 'none',
        userSelect: 'none',
        lineHeight: 1,
        '--counter-color-default': fill.css,
        '--counter-stroke-color-default': stroke.css,
        '--counter-stroke-width-default': strokeWidth,
      }}
    >
      {displayValue}
    </span>
  );
}
