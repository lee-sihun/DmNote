import React, { Profiler, useState } from 'react';

import { NumberInput } from '@components/main/Grid/PropertiesPanel/PropertyInputs';
import type { CommitStrategy } from '@hooks/useOptimisticBooleanCommit';

interface NumberInputBenchmarkSurfaceProps {
  itemCount: number;
  commitStrategy: CommitStrategy;
  onRender?: (durationMs: number) => void;
}

export const NumberInputBenchmarkSurface = ({
  itemCount,
  commitStrategy,
  onRender = () => undefined,
}: NumberInputBenchmarkSurfaceProps) => {
  const [value, setValue] = useState(1);

  return (
    <Profiler
      id="number-input-benchmark"
      onRender={(_, __, duration) => onRender(duration)}
    >
      <div data-canonical-value={value}>
        <NumberInput
          value={value}
          onChange={setValue}
          commitStrategy={commitStrategy}
        />
        <div aria-hidden="true">
          {Array.from({ length: itemCount }, (_, index) => (
            <div
              key={index}
              data-content-value={value}
              style={{
                transform: `translate3d(${(index * value) % 20}px, ${Math.floor(
                  index / 20,
                )}px, 0)`,
                opacity: value === 1 ? 0.72 : 0.96,
                boxShadow:
                  value === 1
                    ? '0 2px 8px rgba(0, 0, 0, 0.18)'
                    : '0 4px 14px rgba(0, 0, 0, 0.28)',
              }}
            >
              {value}-{index}
            </div>
          ))}
        </div>
      </div>
    </Profiler>
  );
};
