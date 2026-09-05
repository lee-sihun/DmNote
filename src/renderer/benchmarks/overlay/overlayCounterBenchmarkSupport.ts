import type { KeyElementPosition } from '@hooks/overlay/useKeyElementStyles';

export type CounterPlacementScenario = 'off' | 'inside' | 'outside';

const FRAME_MS = 1000 / 60;

// OverlayScene과 동일하게 counter 원본 객체를 position에 그대로 싣는다
const createBenchmarkCounter = (
  placement: Exclude<CounterPlacementScenario, 'off'>,
): Record<string, unknown> => ({
  enabled: true,
  placement,
  align: 'bottom',
  alignMode: 'center',
  fill: { idle: '#FFFFFF', active: '#FFFFFF' },
  stroke: { idle: 'transparent', active: 'transparent' },
  gap: 4,
  fontSize: 16,
  fontWeight: 500,
  fontBold: false,
  fontFamily: null,
  fontItalic: false,
  fontUnderline: false,
  fontStrikethrough: false,
  animation: {
    enabled: true,
    presetId: 'builtin-ease-out',
    bezier: [0.25, 0.46, 0.45, 0.94],
    scale: 1.1,
    durationMs: 300,
  },
  fillIdleGradient: null,
  fillActiveGradient: null,
});

export interface BenchmarkLayout {
  keys: string[];
  positions: KeyElementPosition[];
}

export const createBenchmarkLayout = (
  keyCount: number,
  placement: CounterPlacementScenario,
): BenchmarkLayout => {
  const counter =
    placement === 'off' ? undefined : createBenchmarkCounter(placement);
  const keys = Array.from({ length: keyCount }, (_, index) => `Bench${index}`);
  const positions = keys.map<KeyElementPosition>((_, index) => ({
    dx: (index % 10) * 70,
    dy: Math.floor(index / 10) * 70,
    width: 60,
    height: 60,
    counter,
  }));
  return { keys, positions };
};

// rAF를 큐로 대체해 프레임을 수동 배출 — 콜백 수와 콜백 실행 시간을 프레임 단위로 집계.
// 프레임마다 performance.now()에 FRAME_MS 오프셋을 누적해 시간을 건너뛴다.
// 컴포넌트의 startTime·React 스케줄러·테스트 측정이 모두 같은 시계를 보므로
// 애니메이션 진행률이 실제 60Hz와 같이 흐르면서도 실시간 대기 없이 측정된다.
export interface FrameDriver {
  install: () => void;
  restore: () => void;
  // 시간을 한 프레임 진행시킨 뒤 큐의 콜백을 실행. 실행된 콜백 수와 소요 ms 반환
  runFrame: () => { callbacks: number; jsMs: number };
  pending: () => number;
}

export const createFrameDriver = (): FrameDriver => {
  const queue = new Map<number, FrameRequestCallback>();
  let nextId = 0;
  let offsetMs = 0;
  const originalRequest = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  // jsdom window.performance와 Node performance가 다른 객체일 수 있어 둘 다 패치
  const clocks = [...new Set([globalThis.performance, window.performance])];
  const originalNows = clocks.map((clock) => clock.now);

  return {
    install: () => {
      globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
        const id = ++nextId;
        queue.set(id, callback);
        return id;
      };
      globalThis.cancelAnimationFrame = (id: number) => {
        queue.delete(id);
      };
      clocks.forEach((clock, index) => {
        const originalNow = originalNows[index];
        clock.now = () => originalNow.call(clock) + offsetMs;
      });
    },
    restore: () => {
      globalThis.requestAnimationFrame = originalRequest;
      globalThis.cancelAnimationFrame = originalCancel;
      clocks.forEach((clock, index) => {
        clock.now = originalNows[index];
      });
      queue.clear();
      offsetMs = 0;
    },
    runFrame: () => {
      offsetMs += FRAME_MS;
      const batch = [...queue.values()];
      queue.clear();
      const timestamp = performance.now();
      batch.forEach((callback) => callback(timestamp));
      return { callbacks: batch.length, jsMs: performance.now() - timestamp };
    },
    pending: () => queue.size,
  };
};

// jsdom에는 Element.animate가 없다 — WAAPI 경로를 태우기 위한 기록형 스텁.
// 실제 컴포지터 비용은 측정 대상이 아니며 호출 수만 집계한다
export interface AnimateStub {
  install: () => void;
  restore: () => void;
  calls: () => number;
  cancels: () => number;
  reset: () => void;
}

export const createAnimateStub = (): AnimateStub => {
  const proto = Element.prototype as unknown as {
    animate?: (...args: unknown[]) => unknown;
  };
  const original = proto.animate;
  let calls = 0;
  let cancels = 0;

  return {
    install: () => {
      proto.animate = () => {
        calls += 1;
        return {
          cancel: () => {
            cancels += 1;
          },
          playState: 'running',
        };
      };
    },
    restore: () => {
      if (original) proto.animate = original;
      else delete proto.animate;
    },
    calls: () => calls,
    cancels: () => cancels,
    reset: () => {
      calls = 0;
      cancels = 0;
    },
  };
};
