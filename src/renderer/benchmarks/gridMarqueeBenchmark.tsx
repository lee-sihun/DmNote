import React, { Profiler } from 'react';

import { useGridMarquee } from '@hooks/Grid/useGridMarquee';

interface GridMarqueeBenchmarkSurfaceProps {
  strategy: 'legacy' | 'frame';
  itemCount: number;
  onRender?: (durationMs: number) => void;
}

export const GridMarqueeBenchmarkSurface = ({
  strategy,
  itemCount,
  onRender = () => undefined,
}: GridMarqueeBenchmarkSurfaceProps) => {
  const { marqueeEnd } = useGridMarquee({
    positions: {},
    statPositions: {},
    graphPositions: {},
    knobPositions: {},
    selectedKeyType: 'benchmark',
    pluginElements: [],
    clientToGridCoords: (x, y) => ({ x, y }),
    continuousInputStrategy: strategy,
  });
  const endX = marqueeEnd?.x ?? 0;

  return (
    <Profiler
      id="grid-marquee-benchmark"
      onRender={(_, __, duration) => onRender(duration)}
    >
      <div data-benchmark-marquee="true" data-end-x={endX}>
        {Array.from({ length: itemCount }, (_, index) => (
          <div
            key={index}
            style={{ transform: `translate3d(${endX + index}px, 0, 0)` }}
          >
            marquee-{index}
          </div>
        ))}
      </div>
    </Profiler>
  );
};
