import React, { Profiler, useState } from 'react';

import Dropdown from '@components/main/common/dropdown/Dropdown';
import type { CommitStrategy } from '@hooks/useOptimisticBooleanCommit';

interface DropdownBenchmarkSurfaceProps {
  itemCount: number;
  commitStrategy: CommitStrategy;
  onRender?: (durationMs: number) => void;
}

const OPTIONS = [
  { label: '요약', value: 'summary' },
  { label: '상세', value: 'details' },
];

export const DropdownBenchmarkSurface = ({
  itemCount,
  commitStrategy,
  onRender = () => undefined,
}: DropdownBenchmarkSurfaceProps) => {
  const [selectedValue, setSelectedValue] = useState('summary');

  return (
    <Profiler
      id="dropdown-benchmark"
      onRender={(_, __, duration) => onRender(duration)}
    >
      <div data-canonical-value={selectedValue}>
        <Dropdown
          options={OPTIONS}
          value={selectedValue}
          onChange={setSelectedValue}
          commitStrategy={commitStrategy}
        />
        <div aria-hidden="true">
          {Array.from({ length: itemCount }, (_, index) => (
            <div
              key={index}
              data-content-value={selectedValue}
              style={{
                transform: `translate3d(${index % 20}px, ${Math.floor(
                  index / 20,
                )}px, 0)`,
                opacity: selectedValue === 'summary' ? 0.72 : 0.96,
                boxShadow:
                  selectedValue === 'summary'
                    ? '0 2px 8px rgba(0, 0, 0, 0.18)'
                    : '0 4px 14px rgba(0, 0, 0, 0.28)',
              }}
            >
              {selectedValue}-{index}
            </div>
          ))}
        </div>
      </div>
    </Profiler>
  );
};
