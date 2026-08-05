/**
 * 오버레이 상주 컴포넌트의 React 커밋 예산 회귀 테스트
 * - 카운터: count 증가 1회당 커밋 수가 애니메이션 프레임 수에 비례하면 안 됨
 * - 그래프: 유휴(모든 값 0) 상태에서 틱마다 커밋하면 안 됨
 */
import React, { Profiler, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import CountDisplay from '@components/overlay/counters/CountDisplay';
import OverlayGraphItem from '@components/overlay/counters/OverlayGraphItem';

// 그래프 렌더 자체가 아니라 커밋 횟수만 측정 — 무거운 자식은 스텁
vi.mock('@components/shared/GraphPanel', () => ({
  default: () => null,
}));

// 테스트가 신호 값을 직접 제어
const mockStatSignal = { value: 0 };
vi.mock('@stores/signals/statsSignals', () => ({
  getStatValueSignal: () => mockStatSignal,
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let commits: number;

const onRender = (): void => {
  commits += 1;
};

// 실브라우저에서 틱/프레임은 각각 독립 태스크로 커밋됨 — act 배칭을 피하려고
// 스텝 단위로 나눠 진행
const advanceInSteps = (totalMs: number, stepMs: number): void => {
  const steps = Math.ceil(totalMs / stepMs);
  for (let i = 0; i < steps; i += 1) {
    act(() => {
      vi.advanceTimersByTime(stepMs);
    });
  }
};

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
  });
  commits = 0;
  mockStatSignal.value = 0;
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
});

describe('CountDisplay 커밋 예산', () => {
  const renderCount = (count: number): void => {
    act(() => {
      root.render(
        <Profiler id="count" onRender={onRender}>
          <CountDisplay
            count={count}
            animationEnabled
            animationDurationMs={300}
          />
        </Profiler>,
      );
    });
  };

  it('count 증가 1회는 상수 커밋만 발생 (스케일 애니메이션이 커밋을 만들지 않음)', () => {
    renderCount(0);
    advanceInSteps(500, 16);
    commits = 0;

    renderCount(1);
    // 애니메이션 300ms + 여유 (16ms 스텝 = 프레임별 독립 커밋 재현)
    advanceInSteps(600, 16);

    // 수정 전: count 커밋 1 + rAF당 setScale 커밋 (~18) = 20 내외
    expect(commits).toBeLessThanOrEqual(3);
  });

  it('연속 증가(10회)도 증가 횟수에 비례하는 커밋만 발생', () => {
    renderCount(0);
    advanceInSteps(500, 16);
    commits = 0;

    for (let i = 1; i <= 10; i += 1) {
      renderCount(i);
      advanceInSteps(96, 16);
    }
    advanceInSteps(600, 16);

    // 수정 전: 10 커밋 + 프레임별 setScale 커밋 수십
    expect(commits).toBeLessThanOrEqual(13);
  });

  it('애니메이션 후 스케일이 1로 복원됨 (동작 보존)', () => {
    renderCount(0);
    renderCount(1);
    act(() => {
      vi.advanceTimersByTime(50);
    });
    const span = container.querySelector('span.counter') as HTMLSpanElement;
    // 애니메이션 중에는 1보다 큰 스케일
    expect(span.style.transform).not.toBe('scale(1)');
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(span.style.transform).toBe('scale(1)');
  });
});

describe('OverlayGraphItem 유휴 커밋 예산', () => {
  const renderGraph = (): void => {
    act(() => {
      root.render(
        <Profiler id="graph" onRender={onRender}>
          <OverlayGraphItem position={{ statType: 'kps', graphSpeed: 1000 }} />
        </Profiler>,
      );
    });
  };

  it('유휴(값 0) 10초 동안 틱 커밋이 발생하지 않음', () => {
    renderGraph();
    // 초기 안정화 (마운트 직후 첫 틱 포함)
    advanceInSteps(500, 50);
    commits = 0;

    advanceInSteps(10_000, 50);

    // 수정 전: 50ms 틱마다 커밋 = 200회
    expect(commits).toBeLessThanOrEqual(2);
  });

  it('값이 흐르면 다시 커밋하고, 드레인 완료 후 유휴로 복귀', () => {
    renderGraph();
    advanceInSteps(500, 50);

    // 활성: 신호 값이 흐르는 동안 커밋 발생
    commits = 0;
    mockStatSignal.value = 5;
    advanceInSteps(1_000, 50);
    expect(commits).toBeGreaterThanOrEqual(10);

    // 값 0 복귀 → history가 비워질 때까지(graphSpeed 1000ms = 버퍼 10칸)와
    // 마지막 제로 상태 커밋까지 허용
    mockStatSignal.value = 0;
    advanceInSteps(2_000, 50);

    // 완전 유휴 5초: 추가 커밋 없음
    commits = 0;
    advanceInSteps(5_000, 50);
    expect(commits).toBeLessThanOrEqual(2);
  });
});
