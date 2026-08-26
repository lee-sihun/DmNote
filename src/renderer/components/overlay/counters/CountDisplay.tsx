import React, { useLayoutEffect, useRef } from 'react';
import { toCssRgba } from '@utils/color/colorUtils';
import { gradientToCss, type GradientSpec } from '@src/types/color';
import {
  bezierToCssString,
  COUNTER_DEFAULT_BEZIER,
  createCubicBezierEasing,
} from '@utils/cubicBezier';
import { getCounterTypographyStyle } from '@utils/core/counterStyles';
import { useCounterGlyphPaint } from '@hooks/shared/useCounterGlyphPaint';

export interface CountDisplayProps {
  count: number;
  fillColor?: string;
  fillGradient?: GradientSpec | null;
  globalKey?: string;
  active?: boolean;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: number;
  fontBold?: boolean;
  fontItalic?: boolean;
  fontUnderline?: boolean;
  fontStrikethrough?: boolean;
  animationEnabled?: boolean;
  animationBezier?: [number, number, number, number];
  animationScale?: number;
  animationDurationMs?: number;
  useInlineStyles?: boolean;
}

interface ScaleAnimationOptions {
  targetScale: number;
  durationMs: number;
  easing: (t: number) => number;
}

// WAAPI 미지원 환경(jsdom 등)용 rAF 폴백.
// WAAPI와 같은 의미를 유지: 시작 즉시 target scale, 취소 시 즉시 scale(1) 복귀
const startScaleFallbackAnimation = (
  el: HTMLElement,
  { targetScale, durationMs, easing }: ScaleAnimationOptions,
): (() => void) => {
  const startTime = performance.now();
  let frame: number | null = null;
  let currentScale = Number.NaN;

  const applyScale = (value: number): void => {
    currentScale = value;
    el.style.transform = `scale(${value})`;
  };

  const animate = (timestamp: number): void => {
    const progress = Math.min((timestamp - startTime) / durationMs, 1);
    const nextScale = 1 + (targetScale - 1) * (1 - easing(progress));
    if (Math.abs(currentScale - nextScale) > 0.0005) {
      applyScale(nextScale);
    }
    if (progress < 1) {
      frame = requestAnimationFrame(animate);
      return;
    }
    if (currentScale !== 1) applyScale(1);
    frame = null;
  };

  applyScale(targetScale);
  frame = requestAnimationFrame(animate);

  return () => {
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
    applyScale(1);
  };
};

const CountDisplay = ({
  count,
  fillColor,
  fillGradient,
  globalKey: _globalKey,
  active,
  fontSize,
  fontFamily,
  fontWeight,
  fontBold,
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
  const prevCount = useRef<number>(count);
  const animationRef = useRef<Animation | null>(null);
  const cancelFallbackRef = useRef<(() => void) | null>(null);
  const targetScale = Number.isFinite(Number(animationScale))
    ? Number(animationScale)
    : 1.1;
  const durationMs = Math.min(
    Math.max(Math.round(Number(animationDurationMs) || 300), 1),
    5000,
  );
  // easing은 문자열(값 비교)이라 bezier 배열 identity와 무관하게 effect 의존성이 안정적
  const cssEasing = bezierToCssString(animationBezier, 4);
  // 폴백 전용 — 배열 identity를 effect 의존성에 넣지 않기 위해 ref로 전달
  // (선언 순서상 아래 애니메이션 effect보다 먼저 실행됨)
  const bezierRef = useRef(animationBezier);
  useLayoutEffect(() => {
    bezierRef.current = animationBezier;
  });

  // 스케일 팝은 컴포지터 애니메이션(WAAPI)으로 실행 — 프레임당 JS·리페인트 없음.
  // count가 재생 중 다시 바뀌면 cleanup(cancel) 직후 같은 프레임에 처음부터 재생.
  // 인라인 transform: scale(1)이 종료 후 복귀값(fill: none)이므로 유지 필수
  useLayoutEffect(() => {
    const el = spanRef.current;
    if (!el) return undefined;

    const stop = (): void => {
      animationRef.current?.cancel();
      animationRef.current = null;
      cancelFallbackRef.current?.();
      cancelFallbackRef.current = null;
    };

    if (!animationEnabled) {
      stop();
      prevCount.current = count;
      return undefined;
    }
    // 설정 변경으로만 재실행된 경우 — cleanup이 이미 취소했으므로 재생하지 않음
    if (prevCount.current === count) return stop;
    prevCount.current = count;

    if (typeof el.animate === 'function') {
      animationRef.current = el.animate(
        [{ transform: `scale(${targetScale})` }, { transform: 'scale(1)' }],
        { duration: durationMs, easing: cssEasing, fill: 'none' },
      );
    } else {
      cancelFallbackRef.current = startScaleFallbackAnimation(el, {
        targetScale,
        durationMs,
        easing: createCubicBezierEasing(bezierRef.current),
      });
    }
    return stop;
  }, [count, durationMs, cssEasing, targetScale, animationEnabled]);

  const displayValue = count || 0;
  const fill = toCssRgba(fillColor, '#FFFFFF');

  useCounterGlyphPaint(
    spanRef,
    Boolean(fillGradient),
    displayValue,
    // 상태 포함 - data-counter-state 스코프 커스텀 CSS가 메트릭을 바꿀 수 있다
    `${fontSize}|${fontFamily}|${fontWeight}|${
      fontBold ? 'b' : 'r'
    }|${fontItalic}|${active ? 'active' : 'inactive'}`,
  );

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
            fontBold,
            fontItalic,
            fontUnderline,
            fontStrikethrough,
            useInlineStyles,
          }),
          pointerEvents: 'none',
          userSelect: 'none',
          '--counter-color-default': fill.css,
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
          '--dmn-counter-fill-repeat-default': fillGradient
            ? 'no-repeat'
            : 'repeat',
        } as React.CSSProperties
      }
    >
      {displayValue}
    </span>
  );
};

export default CountDisplay;
