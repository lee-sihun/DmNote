/* eslint-disable react-hooks/set-state-in-effect */
import React, { forwardRef, useEffect, useRef, useState } from 'react';

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
  isViewportTransforming?: boolean;
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

function normalizeHistory(history: number[]): number[] {
  if (!Array.isArray(history)) {
    return [];
  }
  return history.map((value: number) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  });
}

function resizeHistory(history: number[], targetSize: number): number[] {
  if (targetSize <= 0) {
    return [];
  }
  if (!history.length) {
    return new Array(targetSize).fill(0);
  }
  if (history.length === targetSize) {
    return [...history];
  }
  if (targetSize === 1) {
    return [history[history.length - 1] || 0];
  }

  const sourceLastIndex = history.length - 1;
  const targetLastIndex = targetSize - 1;
  return Array.from({ length: targetSize }, (_: unknown, index: number) => {
    const sourceIndex = Math.round((index / targetLastIndex) * sourceLastIndex);
    return history[sourceIndex] || 0;
  });
}

function areHistoriesEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (Math.abs(a[index] - b[index]) > 0.001) {
      return false;
    }
  }
  return true;
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
      backgroundColor = 'rgba(17, 17, 20, 0.9)',
      borderColor = 'rgba(255, 255, 255, 0.1)',
      borderWidth = 3,
      borderRadius = 8,
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
      isViewportTransforming = false,
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
    const resolvedGraphType = graphType === 'bar' ? 'bar' : 'line';
    const transform = withOffsetVars
      ? `translate3d(calc(${dx}px + var(--key-offset-x, 0px)), calc(${dy}px + var(--key-offset-y, 0px)), 0)`
      : `translate3d(${dx}px, ${dy}px, 0)`;

    const normalizedHistory = normalizeHistory(history);
    const [animatedLineHistory, setAnimatedLineHistory] = useState<number[]>(
      () => normalizeHistory(history),
    );
    const animatedLineHistoryRef = useRef<number[]>(animatedLineHistory);
    const [animatedBarHistory, setAnimatedBarHistory] = useState<number[]>(() =>
      normalizeHistory(history),
    );
    const animatedBarHistoryRef = useRef<number[]>(animatedBarHistory);
    const lineAnimationFrameRef = useRef<number | null>(null);
    const barAnimationFrameRef = useRef<number | null>(null);

    useEffect(() => {
      animatedLineHistoryRef.current = animatedLineHistory;
    }, [animatedLineHistory]);

    useEffect(() => {
      animatedBarHistoryRef.current = animatedBarHistory;
    }, [animatedBarHistory]);

    useEffect(() => {
      return () => {
        if (lineAnimationFrameRef.current) {
          cancelAnimationFrame(lineAnimationFrameRef.current);
        }
        if (barAnimationFrameRef.current) {
          cancelAnimationFrame(barAnimationFrameRef.current);
        }
      };
    }, []);

    useEffect(() => {
      if (!animationEnabled || resolvedGraphType !== 'line') {
        if (lineAnimationFrameRef.current) {
          cancelAnimationFrame(lineAnimationFrameRef.current);
          lineAnimationFrameRef.current = null;
        }
        setAnimatedLineHistory(normalizedHistory);
        animatedLineHistoryRef.current = normalizedHistory;
        return;
      }

      const targetHistory = normalizedHistory;
      const targetSize = targetHistory.length;
      if (targetSize <= 0) {
        if (lineAnimationFrameRef.current) {
          cancelAnimationFrame(lineAnimationFrameRef.current);
          lineAnimationFrameRef.current = null;
        }
        setAnimatedLineHistory([]);
        animatedLineHistoryRef.current = [];
        return;
      }

      const startHistory = resizeHistory(
        animatedLineHistoryRef.current,
        targetSize,
      );
      if (areHistoriesEqual(startHistory, targetHistory)) {
        if (lineAnimationFrameRef.current) {
          cancelAnimationFrame(lineAnimationFrameRef.current);
          lineAnimationFrameRef.current = null;
        }
        setAnimatedLineHistory(targetHistory);
        animatedLineHistoryRef.current = targetHistory;
        return;
      }

      if (lineAnimationFrameRef.current) {
        cancelAnimationFrame(lineAnimationFrameRef.current);
      }

      const startTime = performance.now();
      const animate = (now: number): void => {
        const t = Math.min(
          1,
          (now - startTime) / Math.max(LINE_ANIMATION_DURATION_MS, 1),
        );
        const eased = 1 - (1 - t) * (1 - t) * (1 - t);
        const nextHistory = startHistory.map(
          (startValue: number, index: number) =>
            startValue + (targetHistory[index] - startValue) * eased,
        );

        setAnimatedLineHistory(nextHistory);
        animatedLineHistoryRef.current = nextHistory;

        if (t < 1) {
          lineAnimationFrameRef.current = requestAnimationFrame(animate);
        } else {
          lineAnimationFrameRef.current = null;
        }
      };

      lineAnimationFrameRef.current = requestAnimationFrame(animate);
    }, [animationEnabled, normalizedHistory, resolvedGraphType]);

    useEffect(() => {
      if (!animationEnabled || resolvedGraphType !== 'bar') {
        if (barAnimationFrameRef.current) {
          cancelAnimationFrame(barAnimationFrameRef.current);
          barAnimationFrameRef.current = null;
        }
        setAnimatedBarHistory(normalizedHistory);
        animatedBarHistoryRef.current = normalizedHistory;
        return;
      }

      const targetHistory = normalizedHistory;
      const targetSize = targetHistory.length;
      if (targetSize <= 0) {
        if (barAnimationFrameRef.current) {
          cancelAnimationFrame(barAnimationFrameRef.current);
          barAnimationFrameRef.current = null;
        }
        setAnimatedBarHistory([]);
        animatedBarHistoryRef.current = [];
        return;
      }

      const startHistory = resizeHistory(
        animatedBarHistoryRef.current,
        targetSize,
      );
      if (areHistoriesEqual(startHistory, targetHistory)) {
        if (barAnimationFrameRef.current) {
          cancelAnimationFrame(barAnimationFrameRef.current);
          barAnimationFrameRef.current = null;
        }
        setAnimatedBarHistory(targetHistory);
        animatedBarHistoryRef.current = targetHistory;
        return;
      }

      if (barAnimationFrameRef.current) {
        cancelAnimationFrame(barAnimationFrameRef.current);
      }

      const startTime = performance.now();
      const animate = (now: number): void => {
        const t = Math.min(
          1,
          (now - startTime) / Math.max(BAR_ANIMATION_DURATION_MS, 1),
        );
        const eased = 1 - (1 - t) * (1 - t) * (1 - t);
        const nextHistory = startHistory.map(
          (startValue: number, index: number) =>
            startValue + (targetHistory[index] - startValue) * eased,
        );

        setAnimatedBarHistory(nextHistory);
        animatedBarHistoryRef.current = nextHistory;

        if (t < 1) {
          barAnimationFrameRef.current = requestAnimationFrame(animate);
        } else {
          barAnimationFrameRef.current = null;
        }
      };

      barAnimationFrameRef.current = requestAnimationFrame(animate);
    }, [animationEnabled, normalizedHistory, resolvedGraphType]);

    const lineHistory =
      resolvedGraphType === 'line' ? animatedLineHistory : normalizedHistory;
    const { points: linePoints, fillPoints } = buildLinePoints(
      lineHistory,
      safeMax,
    );
    const barHistory =
      resolvedGraphType === 'bar' ? animatedBarHistory : normalizedHistory;
    const barPath = buildBarPath(barHistory, safeMax, width, height);

    const resolvedBorderWidth = Number.isFinite(Number(borderWidth))
      ? Math.max(0, Number(borderWidth))
      : 3;
    const resolvedBorderRadius = Number.isFinite(Number(borderRadius))
      ? Math.max(0, Number(borderRadius))
      : 8;
    const useInline = useInlineStyles === true;
    const resolvedBackgroundColor = backgroundColor || 'rgba(17, 17, 20, 0.9)';
    const fallbackBorder =
      resolvedBorderWidth <= 0
        ? 'none'
        : `${resolvedBorderWidth}px solid ${
            borderColor || 'rgba(255, 255, 255, 0.1)'
          }`;
    const resolvedBorder = useInline
      ? fallbackBorder
      : `var(--graph-border, ${fallbackBorder})`;
    const resolvedBg = useInline
      ? resolvedBackgroundColor
      : `var(--graph-bg, ${resolvedBackgroundColor})`;
    const resolvedRadius = useInline
      ? `${resolvedBorderRadius}px`
      : `var(--graph-radius, ${resolvedBorderRadius}px)`;
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
        style={{
          width: `${width}px`,
          height: `${height}px`,
          transform,
          background: resolvedBg,
          color: '#FFFFFF',
          border: resolvedBorder,
          borderRadius: resolvedRadius,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          cursor: interactive ? undefined : 'default',
          fontFamily:
            "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, Roboto, 'Helvetica Neue', sans-serif",
          willChange:
            dataEditing || isViewportTransforming ? 'transform' : 'auto',
          backfaceVisibility: 'hidden',
          transformStyle: 'preserve-3d',
          contain: 'layout style paint',
          imageRendering: 'auto',
          isolation: 'isolate',
          zIndex,
        }}
        data-state="inactive"
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
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: (imageFit ||
                'cover') as React.CSSProperties['objectFit'],
              pointerEvents: 'none',
              userSelect: 'none',
              zIndex: 0,
            }}
          />
        ) : null}
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
