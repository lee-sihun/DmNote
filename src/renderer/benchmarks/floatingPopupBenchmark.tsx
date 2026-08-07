import React, { Profiler, useRef, useState } from 'react';

import FloatingPopup from '@components/main/Modal/FloatingPopup';
import type { CommitStrategy } from '@hooks/useOptimisticBooleanCommit';

interface FloatingPopupBenchmarkSurfaceProps {
  commitStrategy: CommitStrategy;
  itemCount: number;
  onRender?: (durationMs: number) => void;
}

export const FloatingPopupBenchmarkSurface = ({
  commitStrategy,
  itemCount,
  onRender = () => undefined,
}: FloatingPopupBenchmarkSurfaceProps) => {
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);

  return (
    <Profiler
      id="floating-popup-benchmark"
      onRender={(_, __, duration) => onRender(duration)}
    >
      <button
        ref={openerRef}
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        Open popup
      </button>
      <FloatingPopup
        open={open}
        role="menu"
        ariaLabel="Benchmark popup"
        fixedX={0}
        fixedY={0}
        animate={false}
        referenceRef={openerRef}
        contentMountStrategy={commitStrategy}
        onClose={() => setOpen(false)}
        onMenuTab={() => undefined}
      >
        <div data-benchmark-popup-content="true">
          {Array.from({ length: itemCount }, (_, index) => (
            <button
              key={index}
              type="button"
              role="menuitem"
              style={{
                transform: `translate3d(${index % 20}px, ${Math.floor(
                  index / 20,
                )}px, 0)`,
                boxShadow: '0 4px 14px rgba(0, 0, 0, 0.28)',
              }}
            >
              popup-{index}
            </button>
          ))}
        </div>
      </FloatingPopup>
    </Profiler>
  );
};
