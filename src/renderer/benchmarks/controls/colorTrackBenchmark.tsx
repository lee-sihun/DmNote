import React, { Profiler, useState } from 'react';

import { SaturationArea } from '@components/main/Modal/content/pickers/color/colorPickerPrimitives';
import { hsvToColorObject } from '@utils/color/colorUtils';

interface ColorTrackBenchmarkSurfaceProps {
  strategy: 'legacy' | 'frame';
  itemCount: number;
  onRender?: (durationMs: number) => void;
}

const COLOR_TRACK_INITIAL = hsvToColorObject({
  h: 220,
  s: 0,
  v: 100,
  a: 1,
});

export const ColorTrackBenchmarkSurface = ({
  strategy,
  itemCount,
  onRender = () => undefined,
}: ColorTrackBenchmarkSurfaceProps) => {
  const [color, setColor] = useState(COLOR_TRACK_INITIAL);
  return (
    <Profiler
      id="color-track-benchmark"
      onRender={(_, __, duration) => onRender(duration)}
    >
      <div data-benchmark-color-track="true" data-saturation={color.hsv.s}>
        {Array.from({ length: itemCount }, (_, index) => (
          <div
            key={index}
            style={{
              color: color.hex,
              transform: `translate3d(${index % 20}px, ${Math.floor(
                index / 20,
              )}px, 0)`,
            }}
          />
        ))}
        <SaturationArea
          color={color}
          onChange={setColor}
          continuousInputStrategy={strategy}
        />
      </div>
    </Profiler>
  );
};
