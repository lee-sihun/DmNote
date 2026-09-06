// 오버레이 키 카운터 핫패스 벤치마크 서피스
// 실제 오버레이 컴포넌트(Key + KeyCounterLayer)를 마운트하고 Preact signal을 직접 밀어
// press(DOWN → counter → UP)를 재현한다. 프레임은 rAF 스텁 큐를 수동으로 배출해 측정한다.
import React, { Profiler } from 'react';
import { Key } from '@components/shared/key/Key';
import KeyCounterLayer from '@components/overlay/counters/KeyCounterLayer';
import type { BenchmarkLayout } from './overlayCounterBenchmarkSupport';

interface OverlayCounterBenchmarkSurfaceProps {
  layout: BenchmarkLayout;
  mode: string;
  counterEnabled: boolean;
  onRender?: (durationMs: number) => void;
}

export const OverlayCounterBenchmarkSurface = ({
  layout,
  mode,
  counterEnabled,
  onRender,
}: OverlayCounterBenchmarkSurfaceProps) => (
  <Profiler
    id="overlay-counter"
    onRender={(_id, _phase, actualDuration) => onRender?.(actualDuration)}
  >
    <div className="relative">
      {layout.keys.map((key, index) => (
        <Key
          key={key}
          keyName={key}
          globalKey={key}
          position={layout.positions[index]}
          mode={mode}
          counterEnabled={counterEnabled}
        />
      ))}
      {counterEnabled ? (
        <KeyCounterLayer
          keys={layout.keys}
          positions={layout.positions}
          mode={mode}
        />
      ) : null}
    </div>
  </Profiler>
);
