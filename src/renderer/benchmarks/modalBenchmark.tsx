import React, { Profiler, useState } from 'react';

import Modal from '@components/main/Modal/Modal';
import type { CommitStrategy } from '@hooks/useOptimisticBooleanCommit';

interface ModalBenchmarkSurfaceProps {
  commitStrategy: CommitStrategy;
  itemCount: number;
  onRender?: (durationMs: number) => void;
}

export const ModalBenchmarkSurface = ({
  commitStrategy,
  itemCount,
  onRender = () => undefined,
}: ModalBenchmarkSurfaceProps) => {
  const [open, setOpen] = useState(false);

  return (
    <Profiler
      id="modal-benchmark"
      onRender={(_, __, duration) => onRender(duration)}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        Open modal
      </button>
      {open && (
        <Modal
          ariaLabel="Benchmark modal"
          animate={false}
          contentMountStrategy={commitStrategy}
          onClick={() => setOpen(false)}
        >
          <div data-benchmark-modal-content="true">
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
                modal-{index}
              </div>
            ))}
          </div>
        </Modal>
      )}
    </Profiler>
  );
};
