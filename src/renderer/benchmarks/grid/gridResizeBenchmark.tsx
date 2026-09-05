import React, { Profiler, useState } from 'react';

import ResizeHandles from '@components/main/Grid/handles/ResizeHandles';

interface GridResizeBenchmarkSurfaceProps {
  strategy: 'legacy' | 'frame';
  itemCount: number;
  onRender?: (durationMs: number) => void;
}

const BASE_BOUNDS = { x: 0, y: 0, width: 100, height: 100 };

export const GridResizeBenchmarkSurface = ({
  strategy,
  itemCount,
  onRender = () => undefined,
}: GridResizeBenchmarkSurfaceProps) => {
  const [preview, setPreview] = useState(BASE_BOUNDS);
  return (
    <Profiler
      id="grid-resize-benchmark"
      onRender={(_, __, duration) => onRender(duration)}
    >
      <div data-benchmark-resize="true" data-width={preview.width}>
        {Array.from({ length: itemCount }, (_, index) => (
          <div
            key={index}
            style={{
              width: preview.width + index,
              transform: `translate3d(${index % 20}px, ${Math.floor(
                index / 20,
              )}px, 0)`,
            }}
          />
        ))}
        <ResizeHandles
          bounds={BASE_BOUNDS}
          previewBounds={preview}
          continuousInputStrategy={strategy}
          onResize={({ handle: _handle, ...bounds }) => setPreview(bounds)}
          onResizeEnd={() => setPreview(BASE_BOUNDS)}
        />
      </div>
    </Profiler>
  );
};
