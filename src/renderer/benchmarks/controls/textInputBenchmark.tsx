import React, { Profiler, useState } from 'react';

import { TextInput } from '@components/main/Grid/PropertiesPanel/controls/PropertyInputs';
import type { CommitStrategy } from '@hooks/useOptimisticBooleanCommit';

interface TextInputBenchmarkSurfaceProps {
  itemCount: number;
  commitStrategy: CommitStrategy;
  onRender?: (durationMs: number) => void;
}

export const TextInputBenchmarkSurface = ({
  itemCount,
  commitStrategy,
  onRender = () => undefined,
}: TextInputBenchmarkSurfaceProps) => {
  const [value, setValue] = useState('a');

  return (
    <Profiler
      id="text-input-benchmark"
      onRender={(_, __, duration) => onRender(duration)}
    >
      <div data-canonical-value={value}>
        <TextInput
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
                transform: `translate3d(${index % 20}px, ${Math.floor(
                  index / 20,
                )}px, 0)`,
                opacity: value === 'a' ? 0.72 : 0.96,
                boxShadow:
                  value === 'a'
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
