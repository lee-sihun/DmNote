import React, { useEffect, useMemo, useRef } from 'react';
import { toCssRgba } from '@utils/color/colorUtils';
import { gradientToCss, type GradientSpec } from '@src/types/color';
import {
  COUNTER_DEFAULT_BEZIER,
  createCubicBezierEasing,
} from '@utils/cubicBezier';
import { getCounterTypographyStyle } from '@utils/core/counterStyles';

interface CountDisplayProps {
  count: number;
  fillColor?: string;
  fillGradient?: GradientSpec | null;
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
  useInlineStyles?: boolean;
}

const CountDisplay = ({
  count,
  fillColor,
  fillGradient,
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
  useInlineStyles = false,
}: CountDisplayProps) => {
  const spanRef = useRef<HTMLSpanElement | null>(null);
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
    // 스케일은 React 상태 대신 DOM에 직접 반영 — 애니메이션 프레임당 커밋 방지
    const applyScale = (value: number): void => {
      scaleRef.current = value;
      const el = spanRef.current;
      if (el) el.style.transform = `scale(${value})`;
    };

    if (!animationEnabled) {
      prevCount.current = count;
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      if (scaleRef.current !== 1) {
        applyScale(1);
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
          applyScale(nextScale);
        }

        if (progress < 1) {
          animationRef.current = requestAnimationFrame(animate);
        } else {
          if (scaleRef.current !== 1) {
            applyScale(1);
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

  return (
    <span
      ref={spanRef}
      className="counter"
      data-text={displayValue}
      data-counter-state={active ? 'active' : 'inactive'}
      style={
        {
          transform: 'scale(1)',
          transformOrigin: 'center bottom',
          ...getCounterTypographyStyle({
            fontSize,
            fontFamily,
            fontWeight,
            fontItalic,
            fontUnderline,
            fontStrikethrough,
            useInlineStyles,
          }),
          pointerEvents: 'none',
          userSelect: 'none',
          '--counter-color-default': fill.css,
          '--counter-stroke-color-default': stroke.css,
          '--counter-stroke-width-default': strokeWidth,
          // 실제 속성은 global.css의 .counter fallback 규칙이 적용 —
          // 사용자 --counter-color/일반 CSS가 앱 그라데이션보다 우선
          '--dmn-counter-fill-image-default': fillGradient
            ? gradientToCss(fillGradient)
            : 'none',
          '--dmn-counter-fill-clip-default': fillGradient
            ? 'text'
            : 'border-box',
          '--dmn-counter-text-fill-default': fillGradient
            ? 'transparent'
            : 'currentcolor',
        } as React.CSSProperties
      }
    >
      {displayValue}
    </span>
  );
};

export default CountDisplay;
