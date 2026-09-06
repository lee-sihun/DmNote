import React, { useRef } from 'react';
import {
  computeOutsideStyle,
  type useCounterSettings,
} from '@hooks/overlay/useCounterSettings';
import { toCssRgba } from '@utils/color/colorUtils';
import { gradientToCss } from '@src/types/color';
import type { useGradientPreviewSession } from '@stores/grid/useGradientEditStore';
import { DEFAULT_COUNTER_FONT_SIZE } from '@utils/element/elementDefaults';
import { getCounterTypographyStyle } from '@utils/counter/counterStyles';
import { useCounterAxisAnchor } from '@hooks/shared/useCounterAxisAnchor';
import { useCounterGlyphPaint } from '@hooks/shared/useCounterGlyphPaint';

export interface CounterPreviewPosition {
  id: string;
  dx?: number;
  dy?: number;
  width?: number;
  height?: number;
  hidden?: boolean;
  rotation?: number;
  counter?: unknown;
  className?: string;
  useInlineStyles?: boolean;
}

interface CounterPreviewBodyProps {
  position: CounterPreviewPosition;
  value: number;
  counterSettings: ReturnType<typeof useCounterSettings>;
  previewSession: ReturnType<typeof useGradientPreviewSession>;
  previewActive: boolean;
}

// outside 게이트 뒤에서만 마운트 - 글리프 측정 훅이 span 생성과 항상 함께 돈다
const CounterPreviewBody = ({
  position,
  value,
  counterSettings,
  previewSession,
  previewActive,
}: CounterPreviewBodyProps) => {
  const dx = Number.isFinite(position.dx) ? position.dx! : 0;
  const dy = Number.isFinite(position.dy) ? position.dy! : 0;
  const width = Number.isFinite(position.width) ? position.width! : 60;
  const height = Number.isFinite(position.height) ? position.height! : 60;

  const previewFillSpec =
    previewSession?.surface === 'counterFill' ? previewSession.spec : null;

  const fillColor = previewActive
    ? counterSettings.fill.active
    : counterSettings.fill.idle;
  const fillGradient =
    previewFillSpec ??
    (previewActive
      ? counterSettings.fillActiveGradient
      : counterSettings.fillIdleGradient) ??
    null;

  const counterSpanRef = useRef<HTMLSpanElement | null>(null);
  // 글리프 페인트 박스 측정이 축 앵커보다 먼저 - 앵커가 dataset을 읽는다
  useCounterGlyphPaint(
    counterSpanRef,
    Boolean(fillGradient),
    value,
    // 상태 포함 - data-counter-state 스코프 커스텀 CSS가 메트릭을 바꿀 수 있다
    `${counterSettings.fontSize ?? DEFAULT_COUNTER_FONT_SIZE}|${
      counterSettings.fontFamily
    }|${counterSettings.fontWeight}|${counterSettings.fontBold ? 'b' : 'r'}|${
      counterSettings.fontItalic
    }|${previewActive ? 'active' : 'inactive'}`,
  );
  useCounterAxisAnchor(
    previewSession,
    counterSpanRef,
    value,
    undefined,
    'counterFill',
    { x: dx, y: dy },
    position.rotation,
  );

  const style = computeOutsideStyle(
    counterSettings.align,
    dx,
    dy,
    width,
    height,
    counterSettings.gap,
    position.rotation,
  );
  const fill = toCssRgba(fillColor, '#FFFFFF');

  return (
    <div
      className={`pointer-events-none ${position.className || ''}`}
      style={style}
    >
      <span
        ref={counterSpanRef}
        className="counter pointer-events-none select-none"
        data-text={value}
        data-counter-state={previewActive ? 'active' : 'inactive'}
        style={
          {
            ...getCounterTypographyStyle({
              fontSize: counterSettings.fontSize ?? DEFAULT_COUNTER_FONT_SIZE,
              fontFamily: counterSettings.fontFamily,
              fontWeight: counterSettings.fontWeight,
              fontBold: counterSettings.fontBold,
              fontItalic: counterSettings.fontItalic,
              fontUnderline: counterSettings.fontUnderline,
              fontStrikethrough: counterSettings.fontStrikethrough,
              lineHeight: 1,
              useInlineStyles: position.useInlineStyles === true,
            }),
            '--counter-color-default': fill.css,
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
        {value}
      </span>
    </div>
  );
};

export default CounterPreviewBody;
