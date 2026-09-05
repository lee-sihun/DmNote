import React, { Profiler } from 'react';

import { ColorInput } from '@components/main/Grid/PropertiesPanel/controls/PropertyInputs';
import type { CommitStrategy } from '@hooks/useOptimisticBooleanCommit';

interface ColorInputBenchmarkSurfaceProps {
  commitStrategy: CommitStrategy;
  onRender?: (durationMs: number) => void;
}

export const ColorInputBenchmarkSurface = ({
  commitStrategy,
  onRender = () => undefined,
}: ColorInputBenchmarkSurfaceProps) => (
  <Profiler
    id="color-input-benchmark"
    onRender={(_, __, duration) => onRender(duration)}
  >
    <ColorInput
      value="#561ecb"
      onChange={() => undefined}
      pickerMountStrategy={commitStrategy}
    />
  </Profiler>
);
