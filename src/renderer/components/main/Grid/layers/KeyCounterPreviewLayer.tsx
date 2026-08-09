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

interface KeyCounterPreviewProps {
  position: CounterPosition;
  index: number;
  previewValue?: number;
  isInBatchSelection?: boolean;
}

interface KeyCounterPreviewLayerProps {
  positions: CounterPosition[];
  previewValue?: number;
  selectedElements?: SelectedElement[];
}

// 프리뷰로 위치 하나가 바뀌면 컴파일러가 map 전체를 한 단위로 캐시하고 있어
// 목록이 통째로 다시 돈다. 이때 leaf를 memo로 격리하지 않으면 안 바뀐 항목까지
// Zod 정규화를 다시 돌린다 - useCounterSettings는 use 접두사라 컴파일러가
// 훅으로 보고 절대 메모하지 않는다 (실측 키 100개 기준 0.267ms -> 0.077ms).
// 위치 객체는 프리뷰 합성에서 바뀐 대상만 새로 만들어지므로 얕은 비교로 충분하다.
// 그라디언트 편집 세션은 leaf가 직접 구독하므로 memo가 막지 않는다
const KeyCounterPreview = React.memo(function KeyCounterPreview({
  position,
  index,
  previewValue = 0,
  isInBatchSelection = false,
}: KeyCounterPreviewProps) {
  const dx = Number.isFinite(position?.dx) ? position.dx! : 0;
  const dy = Number.isFinite(position?.dy) ? position.dy! : 0;
  const width = Number.isFinite(position?.width) ? position.width! : 60;
  const height = Number.isFinite(position?.height) ? position.height! : 60;

  const counterSettings = useCounterSettings(position?.counter);
  // 편집 세션 일시 페인트 — 다른 표면을 편집해도 같은 대기/입력 상태 유지
  const previewSession = useGradientPreviewSession(
    'key',
    index,
    isInBatchSelection,
  );
  const previewActive = previewSession?.stateMode === 'active';
  const previewFillSpec =
    previewSession?.surface === 'counterFill' ? previewSession.spec : null;

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
        data-text={previewValue}
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
        {previewValue}
      </span>
    </div>
  );
});

const KeyCounterPreviewLayer = ({
  positions,
  previewValue = 0,
  selectedElements = [],
}: KeyCounterPreviewLayerProps) => {
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
            index={index}
            previewValue={previewValue}
            isInBatchSelection={selectedElements.some(
              (element) => element.type === 'key' && element.index === index,
            )}
          />
        );
      })}
    </div>
  );
};

export default KeyCounterPreviewLayer;
