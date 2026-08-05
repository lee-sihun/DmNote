import React from 'react';
import {
  useCounterSettings,
  computeOutsideStyle,
} from '@hooks/overlay/useCounterSettings';
import { toCssRgba } from '@utils/color/colorUtils';
import { gradientToCss } from '@src/types/color';
import { useGradientPreviewSession } from '@stores/grid/useGradientEditStore';
import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import { DEFAULT_COUNTER_FONT_SIZE } from '@utils/core/elementDefaults';
import { getCounterTypographyStyle } from '@utils/core/counterStyles';

interface CounterPosition {
  dx?: number;
  dy?: number;
  width?: number;
  height?: number;
  hidden?: boolean;
  counter?: unknown;
  className?: string;
  useInlineStyles?: boolean;
}

interface StatCounterProps {
  position: CounterPosition;
  index: number;
  previewValue?: number;
  isInBatchSelection?: boolean;
}

interface StatCounterLayerProps {
  positions: CounterPosition[];
  selectedElements?: SelectedElement[];
}

const StatCounter = ({
  position,
  index,
  previewValue = 0,
  isInBatchSelection = false,
}: StatCounterProps) => {
  const dx = Number.isFinite(position?.dx) ? position.dx! : 0;
  const dy = Number.isFinite(position?.dy) ? position.dy! : 0;
  const width = Number.isFinite(position?.width) ? position.width! : 60;
  const height = Number.isFinite(position?.height) ? position.height! : 60;

  const counterSettings = useCounterSettings(position?.counter);
  // 편집 세션 일시 페인트 — 다른 표면을 편집해도 같은 대기/입력 상태 유지
  const previewSession = useGradientPreviewSession(
    'stat',
    index,
    isInBatchSelection,
  );
  const previewActive = previewSession?.stateMode === 'active';
  const previewFillSpec =
    previewSession?.surface === 'counterFill' ? previewSession.spec : null;

  if (!counterSettings.enabled || counterSettings.placement !== 'outside') {
    return null;
  }

  const count = (previewValue ?? 0) | 0;

  const style = computeOutsideStyle(
    counterSettings.align,
    dx,
    dy,
    width,
    height,
    counterSettings.gap,
  );

  const fillColor = previewActive
    ? counterSettings.fill.active
    : counterSettings.fill.idle;
  const strokeColor = previewActive
    ? counterSettings.stroke.active
    : counterSettings.stroke.idle;
  const fillGradient =
    previewFillSpec ??
    (previewActive
      ? counterSettings.fillActiveGradient
      : counterSettings.fillIdleGradient) ??
    null;

  const fill = toCssRgba(fillColor, '#FFFFFF');
  const stroke = toCssRgba(strokeColor, 'transparent');
  const strokeWidth = stroke.alpha > 0 ? '1px' : '0px';

  return (
    <div
      className={`pointer-events-none ${position.className || ''}`}
      style={style}
    >
      <span
        className="counter pointer-events-none select-none"
        data-text={count}
        data-counter-state={previewActive ? 'active' : 'inactive'}
        style={
          {
            ...getCounterTypographyStyle({
              fontSize: counterSettings.fontSize ?? DEFAULT_COUNTER_FONT_SIZE,
              fontFamily: counterSettings.fontFamily,
              fontWeight: counterSettings.fontWeight,
              fontItalic: counterSettings.fontItalic,
              fontUnderline: counterSettings.fontUnderline,
              fontStrikethrough: counterSettings.fontStrikethrough,
              lineHeight: 1,
              useInlineStyles: position.useInlineStyles === true,
            }),
            '--counter-color-default': fill.css,
            '--counter-stroke-color-default': stroke.css,
            '--counter-stroke-width-default': strokeWidth,
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
        {count}
      </span>
    </div>
  );
};

const StatCounterLayer = ({
  positions,
  selectedElements = [],
}: StatCounterLayerProps) => {
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
          <StatCounter
            key={`stat-counter-${index}`}
            position={position}
            index={index}
            previewValue={0}
            isInBatchSelection={selectedElements.some(
              (element) => element.type === 'stat' && element.index === index,
            )}
          />
        );
      })}
    </div>
  );
};

export default StatCounterLayer;
