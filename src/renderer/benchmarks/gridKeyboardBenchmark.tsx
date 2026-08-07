import React, { Profiler, useCallback, useMemo, useRef, useState } from 'react';

import { useGridKeyboard } from '@hooks/Grid/useGridKeyboard';

interface GridKeyboardBenchmarkSurfaceProps {
  strategy: 'sync' | 'frame';
  itemCount: number;
  onRender?: (durationMs: number) => void;
}

export const GridKeyboardBenchmarkSurface = ({
  strategy,
  itemCount,
  onRender = () => undefined,
}: GridKeyboardBenchmarkSurfaceProps) => {
  const [offset, setOffset] = useState(0);
  const itemIndexes = useMemo(
    () => Array.from({ length: itemCount }, (_, index) => index),
    [itemCount],
  );
  const positionsRef = useRef(
    Array.from({ length: itemCount }, (_, index) => ({ x: index, y: index })),
  );
  const selectedElements = useMemo(
    () => [{ type: 'key' as const, id: 'benchmark-key', index: 0 }],
    [],
  );
  const moveSelectedElements = useCallback((deltaX: number) => {
    // 실제 이동 경로처럼 선택 데이터 전체의 projection 비용을 포함
    positionsRef.current = positionsRef.current.map((position) => ({
      ...position,
      x: position.x + deltaX,
    }));
    setOffset((current) => current + deltaX);
  }, []);

  useGridKeyboard({
    selectedElements,
    moveSelectedElements,
    deleteSelectedElements: () => undefined,
    clearSelection: () => undefined,
    copySelectedElements: () => undefined,
    pasteElements: () => undefined,
    continuousInputStrategy: strategy,
  });

  return (
    <Profiler
      id="grid-keyboard-benchmark"
      onRender={(_, __, duration) => onRender(duration)}
    >
      <div data-benchmark-grid-keyboard="true" data-offset={offset}>
        {itemIndexes.map((index) => (
          <div
            key={index}
            style={{
              transform: `translate3d(${index + offset}px, ${index}px, 0)`,
              boxShadow: '0 4px 14px rgba(0, 0, 0, 0.28)',
            }}
          >
            keyboard-{index}
          </div>
        ))}
      </div>
    </Profiler>
  );
};
