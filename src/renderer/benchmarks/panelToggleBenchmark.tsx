import React, { Profiler, useState } from 'react';

import PanelToggleButton from '@components/main/Grid/PropertiesPanel/PanelToggleButton';
import type { CommitStrategy } from '@hooks/useOptimisticBooleanCommit';

interface PanelToggleBenchmarkSurfaceProps {
  commitStrategy: CommitStrategy;
  itemCount: number;
  onRender?: (durationMs: number) => void;
}

export const PanelToggleBenchmarkSurface = ({
  commitStrategy,
  itemCount,
  onRender = () => undefined,
}: PanelToggleBenchmarkSurfaceProps) => {
  const [open, setOpen] = useState(false);

  return (
    <Profiler
      id="panel-toggle-benchmark"
      onRender={(_, __, duration) => onRender(duration)}
    >
      <PanelToggleButton
        open={open}
        onClick={() => setOpen((current) => !current)}
        commitStrategy={commitStrategy}
      />
      {open && (
        <div data-benchmark-panel-content="true">
          {Array.from({ length: itemCount }, (_, index) => (
            <div
              key={index}
              style={{
                transform: `translate3d(${index % 20}px, ${Math.floor(
                  index / 20,
                )}px, 0)`,
                boxShadow: '0 4px 14px rgba(0, 0, 0, 0.28)',
              }}
            >
              panel-{index}
            </div>
          ))}
        </div>
      )}
    </Profiler>
  );
};
