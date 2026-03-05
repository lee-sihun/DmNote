import React, { memo } from 'react';
import {
  useCounterSettings,
  computeOutsideStyle,
} from '@hooks/shared/useCounterSettings';
import { toCssRgba } from '@utils/color/colorUtils';

interface CounterPosition {
  dx?: number;
  dy?: number;
  width?: number;
  height?: number;
  hidden?: boolean;
  counter?: any;
}

interface KeyCounterPreviewProps {
  position: CounterPosition;
  previewValue?: number;
}

interface KeyCounterPreviewLayerProps {
  positions: CounterPosition[];
  previewValue?: number;
}

const KeyCounterPreview = memo(
  ({ position, previewValue = 0 }: KeyCounterPreviewProps) => {
    const dx = Number.isFinite(position?.dx) ? position.dx! : 0;
    const dy = Number.isFinite(position?.dy) ? position.dy! : 0;
    const width = Number.isFinite(position?.width) ? position.width! : 60;
    const height = Number.isFinite(position?.height) ? position.height! : 60;

    const counterSettings = useCounterSettings(position?.counter);

    // 개별 키의 카운터가 비활성화되었거나 outside가 아니면 렌더링하지 않음
    if (!counterSettings.enabled || counterSettings.placement !== 'outside') {
      return null;
    }

    const style = computeOutsideStyle(
      counterSettings.align,
      dx,
      dy,
      width,
      height,
      counterSettings.gap,
    );

    const fillColor = counterSettings.fill.idle;
    const strokeColor = counterSettings.stroke.idle;

    const fill = toCssRgba(fillColor, '#FFFFFF');
    const stroke = toCssRgba(strokeColor, 'transparent');
    const strokeWidth = stroke.alpha > 0 ? '1px' : '0px';

    const textDecorations: string[] = [];
    if (counterSettings.fontUnderline) textDecorations.push('underline');
    if (counterSettings.fontStrikethrough)
      textDecorations.push('line-through');
    const textDecoration =
      textDecorations.length > 0 ? textDecorations.join(' ') : 'none';

    return (
      <div className="pointer-events-none" style={style}>
        <span
          className="counter pointer-events-none select-none"
          data-text={previewValue}
          data-counter-state="inactive"
          style={
            {
              fontSize: `${counterSettings.fontSize ?? 16}px`,
              fontFamily: counterSettings.fontFamily
                ? `"${counterSettings.fontFamily}", "SUIT-Regular", sans-serif`
                : undefined,
              fontWeight: counterSettings.fontWeight ?? 400,
              fontStyle: counterSettings.fontItalic ? 'italic' : 'normal',
              textDecoration,
              lineHeight: 1,
              '--counter-color-default': fill.css,
              '--counter-stroke-color-default': stroke.css,
              '--counter-stroke-width-default': strokeWidth,
            } as React.CSSProperties
          }
        >
          {previewValue}
        </span>
      </div>
    );
  },
);

export default function KeyCounterPreviewLayer({
  positions,
  previewValue = 0,
}: KeyCounterPreviewLayerProps) {
  if (!positions?.length) {
    return null;
  }

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 12 }}
    >
      {positions.map((position, index) => {
        if (!position) return null;
        if (position.hidden) return null;
        return (
          <KeyCounterPreview
            key={`counter-preview-${index}`}
            position={position}
            previewValue={previewValue}
          />
        );
      })}
    </div>
  );
}
