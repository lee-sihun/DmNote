import React, { forwardRef, useMemo } from 'react';
import {
  DEFAULT_ELEMENT_BG,
  DEFAULT_ELEMENT_RADIUS,
} from '@utils/element/elementDefaults';
import { resolveElementBorder } from '@utils/element/elementBorder';
import {
  gradientToCss,
  gradientRingStyle,
  type GradientSpec,
} from '@src/types/color';
import {
  normalizeGraphHistory,
  useAnimatedGraphHistory,
} from './useAnimatedGraphHistory';

const BAR_ANIMATION_DURATION_MS = 150;
const LINE_ANIMATION_DURATION_MS = 150;

interface GraphPanelProps {
  dx?: number;
  dy?: number;
  width?: number;
  height?: number;
  zIndex?: number;
  className?: string;
  graphType?: 'line' | 'bar';
  graphColor?: string;
  showAvgLine?: boolean;
  backgroundColor?: string;
  borderColor?: string;
  backgroundGradient?: GradientSpec | null;
  borderGradient?: GradientSpec | null;
  borderWidth?: number;
  borderRadius?: number;
  imageSrc?: string | null;
  imageFit?: string;
  useInlineStyles?: boolean;
  animationEnabled?: boolean;
  history?: number[];
  avg?: number;
  maxval?: number;
  uid?: string;
  withOffsetVars?: boolean;
  interactive?: boolean;
  dataEditing?: boolean;
  overlayHitRegion?: boolean;
  promoteTransformLayer?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  onPointerDown?: (e: React.PointerEvent<HTMLElement>) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onDragStart?: (e: React.DragEvent) => void;
}

function buildLinePoints(
  history: number[],
  safeMax: number,
): { points: string; fillPoints: string } {
  const denominator = Math.max(history.length - 1, 1);
  const baselineY = 101; // 선 그래프 베이스 라인
  const points = history
    .map((rawValue: number, index: number) => {
      const value = Number(rawValue) || 0;
      const x = (index / denominator) * 100;
      const y =
        value <= 0 ? baselineY : 100 - Math.min((value / safeMax) * 100, 100);
      return `${x},${y}`;
    })
    .join(' ');

  const fillPoints = [
    `0,${baselineY}`,
    ...history.map((rawValue: number, index: number) => {
      const value = Number(rawValue) || 0;
      const x = (index / denominator) * 100;
      const y =
        value <= 0 ? baselineY : 100 - Math.min((value / safeMax) * 100, 100);
      return `${x},${y}`;
    }),
    `100,${baselineY}`,
  ].join(' ');

  return { points, fillPoints };
}

function buildBarPath(
  history: number[],
  safeMax: number,
  width: number,
  height: number,
): string {
  const count = history.length;
  if (count <= 0) {
    return '';
  }

  const safeWidth = Math.max(Number(width) || 0, 1);
  const safeHeightPx = Math.max(Number(height) || 0, 1);
  const gap = (1 / safeWidth) * 100;
  const totalGap = gap * Math.max(count - 1, 0);
  const barWidth = Math.max((100 - totalGap) / count, 0);
  const radiusXBase = (2 / safeWidth) * 100;
  const radiusYBase = (2 / safeHeightPx) * 100;

  let path = '';
  for (let index = 0; index < count; index += 1) {
    const value = history[index] || 0;
    const normalized = Math.min((value / safeMax) * 100, 100);
    if (normalized <= 0) {
      continue;
    }
    const barHeight = normalized;
    const x = index * (barWidth + gap);
    const y = 100 - barHeight;
    const radiusX = Math.min(radiusXBase, barWidth / 2);
    const radiusY = Math.min(radiusYBase, barHeight);
    const right = x + barWidth;

    path +=
      `M ${x} 100 ` +
      `L ${x} ${y + radiusY} ` +
      `Q ${x} ${y} ${x + radiusX} ${y} ` +
      `L ${right - radiusX} ${y} ` +
      `Q ${right} ${y} ${right} ${y + radiusY} ` +
      `L ${right} 100 Z `;
  }

  return path.trim();
}

const GraphPanel = forwardRef<HTMLDivElement, GraphPanelProps>(
  function GraphPanel(
    {
      dx = 0,
      dy = 0,
      width = 200,
      height = 100,
      zIndex = 0,
      className = '',
      graphType = 'line',
      graphColor = '#86EFAC',
      showAvgLine = true,
      backgroundColor = DEFAULT_ELEMENT_BG,
      borderColor,
      backgroundGradient = null,
      borderGradient,
      borderWidth,
      borderRadius = DEFAULT_ELEMENT_RADIUS,
      imageSrc = null,
      imageFit = 'cover',
      useInlineStyles = false,
      animationEnabled = true,
      history = [],
      avg = 0,
      maxval = 1,
      uid = 'graph',
      withOffsetVars = true,
      interactive = true,
      dataEditing,
      overlayHitRegion = false,
      promoteTransformLayer,
      onClick,
      onDoubleClick,
      onMouseDown,
      onPointerDown,
      onContextMenu,
      onDragStart,
    },
    ref,
  ) {
    const safeMax = maxval > 0 ? maxval : 1;
    const shouldPromoteTransformLayer =
      !interactive || promoteTransformLayer === true;
    const resolvedGraphType = graphType === 'bar' ? 'bar' : 'line';
    const transform = withOffsetVars
      ? interactive
        ? `translate(calc(${dx}px + var(--key-offset-x, 0px)), calc(${dy}px + var(--key-offset-y, 0px)))`
        : `translate3d(calc(${dx}px + var(--key-offset-x, 0px)), calc(${dy}px + var(--key-offset-y, 0px)), 0)`
      : interactive
      ? `translate(${dx}px, ${dy}px)`
      : `translate3d(${dx}px, ${dy}px, 0)`;

    const normalizedHistory = useMemo(
      () => normalizeGraphHistory(history),
      [history],
    );
    const animatedLineHistory = useAnimatedGraphHistory(
      normalizedHistory,
      animationEnabled && resolvedGraphType === 'line',
      LINE_ANIMATION_DURATION_MS,
    );
    const animatedBarHistory = useAnimatedGraphHistory(
      normalizedHistory,
      animationEnabled && resolvedGraphType === 'bar',
      BAR_ANIMATION_DURATION_MS,
    );

    const lineHistory =
      resolvedGraphType === 'line' ? animatedLineHistory : normalizedHistory;
    const { points: linePoints, fillPoints } = buildLinePoints(
      lineHistory,
      safeMax,
    );
    const barHistory =
      resolvedGraphType === 'bar' ? animatedBarHistory : normalizedHistory;
    const barPath = buildBarPath(barHistory, safeMax, width, height);

    // store는 미지정을 null로 직렬화한다. Number(null)은 0이라 유한수 검사만으로는
    // 무보더·반경 0으로 잘못 읽히므로 null·undefined를 먼저 미지정으로 본다
    const explicitBorderWidth =
      borderWidth != null && Number.isFinite(Number(borderWidth))
        ? Math.max(0, Number(borderWidth))
        : undefined;
    const resolvedBorderRadius =
      borderRadius != null && Number.isFinite(Number(borderRadius))
        ? Math.max(0, Number(borderRadius))
        : DEFAULT_ELEMENT_RADIUS;
    const useInline = useInlineStyles === true;
    const resolvedBackgroundColor = backgroundGradient
      ? gradientToCss(backgroundGradient)
      : backgroundColor || DEFAULT_ELEMENT_BG;
    // 보더는 키와 같은 공용 해석기. 그라데이션 보더는 보더 대신 동일 두께
    // padding - overflow:hidden이 패딩 박스에서 클리핑되므로 링 자식이
    // 가장자리에 정확히 그려짐
    const resolvedGraphBorder = resolveElementBorder(
      { borderColor, borderGradient, borderWidth: explicitBorderWidth },
      false,
    );
    const resolvedBorderWidth = resolvedGraphBorder.width;
    const borderRingSpec = resolvedGraphBorder.gradient;
    const showBorderRing = borderRingSpec != null && resolvedBorderWidth > 0;
    const resolvedBorder =
      !showBorderRing && resolvedBorderWidth > 0
        ? `${resolvedBorderWidth}px solid ${resolvedGraphBorder.color}`
        : 'none';
    const resolvedGraphColor = graphColor || '#86EFAC';
    const graphStrokeColor = useInline
      ? resolvedGraphColor
      : `var(--graph-color, ${resolvedGraphColor})`;

    const avgY = 100 - Math.min((avg / safeMax) * 100, 100);

    return (
      <div
        ref={ref}
        className={`absolute select-none ${
          interactive ? 'dmn-grabbable' : ''
        } ${className || ''}`}
        style={
          {
            width: `${width}px`,
            height: `${height}px`,
            transform,
            ...(useInline
              ? {
                  background: resolvedBackgroundColor,
                  backgroundClip: 'padding-box',
                  color: '#FFFFFF',
                  border: resolvedBorder,
                  padding: showBorderRing
                    ? `${resolvedBorderWidth}px`
                    : undefined,
                  borderRadius: `${resolvedBorderRadius}px`,
                  fontFamily:
                    "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, Roboto, 'Helvetica Neue', sans-serif",
                }
              : {
                  '--dmn-graph-bg-default': resolvedBackgroundColor,
                  '--dmn-graph-border-default': resolvedBorder,
                  '--dmn-graph-radius-default': `${resolvedBorderRadius}px`,
                  '--dmn-graph-padding-default': showBorderRing
                    ? `${resolvedBorderWidth}px`
                    : '0px',
                  '--dmn-graph-text-color-default': '#FFFFFF',
                  '--dmn-graph-font-family-default':
                    "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, Roboto, 'Helvetica Neue', sans-serif",
                }),
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            cursor: interactive ? undefined : 'default',
            willChange: shouldPromoteTransformLayer ? 'transform' : 'auto',
            backfaceVisibility: interactive ? 'visible' : 'hidden',
            transformStyle: interactive ? 'flat' : 'preserve-3d',
            contain: interactive ? 'layout style' : 'layout style paint',
            imageRendering: 'auto',
            isolation: 'isolate',
            zIndex,
          } as React.CSSProperties
        }
        data-state="inactive"
        data-graph-element="true"
        data-overlay-hit={overlayHitRegion ? 'true' : undefined}
        data-editing={dataEditing ? 'true' : undefined}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onMouseDown={onMouseDown}
        onPointerDown={onPointerDown}
        onContextMenu={onContextMenu}
        onDragStart={onDragStart}
      >
        {imageSrc ? (
          <img
            src={imageSrc}
            alt=""
            draggable={false}
            data-graph-image="true"
            style={{
              position: 'absolute',
              objectFit: (imageFit ||
                'cover') as React.CSSProperties['objectFit'],
              pointerEvents: 'none',
              userSelect: 'none',
              zIndex: 0,
            }}
          />
        ) : null}
        {showBorderRing && borderRingSpec && (
          <span
            aria-hidden="true"
            data-gradient-border-ring="true"
            style={{
              ...gradientRingStyle(borderRingSpec, resolvedBorderWidth),
              ...(useInline
                ? { background: gradientToCss(borderRingSpec) }
                : {}),
              zIndex: 1,
            }}
          />
        )}
        {resolvedGraphType === 'bar' ? (
          <div
            style={{
              display: 'flex',
              flex: 1,
              minHeight: 0,
              background: 'transparent',
              position: 'relative',
              zIndex: 1,
            }}
          >
            <svg
              width="100%"
              height="100%"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                width: '100%',
                height: '100%',
              }}
            >
              <defs>
                <linearGradient
                  id={`barGradient-${uid}`}
                  x1="0%"
                  y1="0%"
                  x2="100%"
                  y2="0%"
                >
                  <stop
                    offset="0%"
                    style={{ stopColor: graphStrokeColor, stopOpacity: 0.3 }}
                  />
                  <stop
                    offset="100%"
                    style={{ stopColor: graphStrokeColor, stopOpacity: 1 }}
                  />
                </linearGradient>
              </defs>
              {barPath ? (
                <path d={barPath} fill={`url(#barGradient-${uid})`} />
              ) : null}
            </svg>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
              flex: 1,
              minHeight: 0,
              background: 'transparent',
              gap: '1px',
              position: 'relative',
              zIndex: 1,
            }}
          >
            <svg
              width="100%"
              height="100%"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                width: '100%',
                height: '100%',
              }}
            >
              <defs>
                <linearGradient
                  id={`lineGradient-${uid}`}
                  x1="0%"
                  y1="0%"
                  x2="100%"
                  y2="0%"
                >
                  <stop
                    offset="0%"
                    style={{ stopColor: graphStrokeColor, stopOpacity: 0.3 }}
                  />
                  <stop
                    offset="100%"
                    style={{ stopColor: graphStrokeColor, stopOpacity: 1 }}
                  />
                </linearGradient>
                <linearGradient
                  id={`fillGradient-${uid}`}
                  x1="0%"
                  y1="0%"
                  x2="100%"
                  y2="0%"
                >
                  <stop
                    offset="0%"
                    style={{ stopColor: graphStrokeColor, stopOpacity: 0.05 }}
                  />
                  <stop
                    offset="100%"
                    style={{ stopColor: graphStrokeColor, stopOpacity: 0.15 }}
                  />
                </linearGradient>
              </defs>
              <polygon points={fillPoints} fill={`url(#fillGradient-${uid})`} />
              {showAvgLine ? (
                <line
                  x1="0"
                  y1={avgY}
                  x2="100"
                  y2={avgY}
                  stroke={graphStrokeColor}
                  strokeWidth="1"
                  strokeDasharray="2,2"
                  opacity="0.5"
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
              <polyline
                points={linePoints}
                fill="none"
                stroke={`url(#lineGradient-${uid})`}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </div>
        )}
      </div>
    );
  },
);

export default GraphPanel;
