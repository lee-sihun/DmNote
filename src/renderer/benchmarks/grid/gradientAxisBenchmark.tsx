/* eslint-disable react-refresh/only-export-components */
import React, { Profiler, useCallback, useEffect } from 'react';

import GradientAxisOverlay from '@components/main/Grid/handles/GradientAxisHandle';
import {
  useGradientEditStore,
  useGradientPreviewSpec,
} from '@stores/grid/useGradientEditStore';
import type { GradientSpec } from '@src/types/color';

const SESSION_KEY = 'benchmark:key:0:backgroundColor:idle';
const benchmarkId = (index: number) =>
  `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

export const GRADIENT_BENCHMARK_SPEC: GradientSpec = {
  angle: 90,
  stops: [
    { color: '#ff0000', pos: 0 },
    { color: '#0000ff', pos: 1 },
  ],
};

const GradientPreviewNode = ({ index }: { index: number }) => {
  const preview = useGradientPreviewSpec(
    'key',
    benchmarkId(index),
    'background',
  );
  return (
    <div
      style={{
        transform: `translate3d(${index % 20}px, ${Math.floor(
          index / 20,
        )}px, 0)`,
        background: preview?.stops[0]?.color ?? '#202024',
      }}
    />
  );
};

interface GradientAxisBenchmarkSurfaceProps {
  strategy: 'legacy' | 'frame';
  itemCount: number;
  onRender?: (durationMs: number) => void;
}

export const GradientAxisBenchmarkSurface = ({
  strategy,
  itemCount,
  onRender = () => undefined,
}: GradientAxisBenchmarkSurfaceProps) => {
  const preview = useGradientPreviewSpec('key', benchmarkId(0), 'background');
  const apply = useCallback((spec: GradientSpec) => {
    useGradientEditStore.getState().patchSession(SESSION_KEY, { spec });
  }, []);

  useEffect(() => {
    useGradientEditStore.getState().setSession({
      anchor: { kind: 'key', id: benchmarkId(0) },
      sessionKey: SESSION_KEY,
      surface: 'background',
      stateMode: 'idle',
      spec: GRADIENT_BENCHMARK_SPEC,
      selectedIndex: 0,
      selectStop: () => undefined,
      apply,
    });
    return () => {
      const store = useGradientEditStore.getState();
      if (store.session?.sessionKey === SESSION_KEY) store.setSession(null);
    };
  }, [apply]);

  const positions = {
    benchmark: Array.from({ length: itemCount }, (_, index) => ({
      id: benchmarkId(index),
      dx: 100 + (index % 20),
      dy: 100 + Math.floor(index / 20),
      width: 200,
      height: 100,
    })),
  } as never;

  return (
    <Profiler
      id="gradient-axis-benchmark"
      onRender={(_, __, duration) => onRender(duration)}
    >
      <div
        data-benchmark-gradient-axis="true"
        data-stop-pos={preview?.stops[0]?.pos ?? 0}
      >
        {Array.from({ length: itemCount }, (_, index) => (
          <GradientPreviewNode key={index} index={index} />
        ))}
        <GradientAxisOverlay
          positions={positions}
          statPositions={{}}
          graphPositions={{}}
          knobPositions={{}}
          selectedElements={[]}
          selectedKeyType="benchmark"
          zoom={1}
          panX={0}
          panY={0}
          continuousInputStrategy={strategy}
        />
      </div>
    </Profiler>
  );
};
