import React, { Profiler, useRef } from 'react';

import { useGridZoomPan } from '@hooks/Grid/useGridZoomPan';

interface GridContinuousInputBenchmarkSurfaceProps {
  strategy: 'legacy' | 'frame';
  itemCount: number;
  onRender?: (durationMs: number) => void;
}

export const GridContinuousInputBenchmarkSurface = ({
  strategy,
  itemCount,
  onRender = () => undefined,
}: GridContinuousInputBenchmarkSurfaceProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const { panX, panY } = useGridZoomPan({
    mode: 'benchmark',
    containerRef,
    contentRef,
    continuousInputStrategy: strategy,
  });

  return (
    <Profiler
      id="grid-continuous-input-benchmark"
      onRender={(_, __, duration) => onRender(duration)}
    >
      <div
        ref={containerRef}
        data-benchmark-grid-container="true"
        data-pan-x={panX}
      >
        <div ref={contentRef}>
          {Array.from({ length: itemCount }, (_, index) => (
            <div
              key={index}
              style={{
                transform: `translate3d(${panX + (index % 20)}px, ${
                  panY + Math.floor(index / 20)
                }px, 0)`,
                boxShadow: '0 4px 14px rgba(0, 0, 0, 0.28)',
              }}
            >
              grid-{index}
            </div>
          ))}
        </div>
      </div>
    </Profiler>
  );
};
