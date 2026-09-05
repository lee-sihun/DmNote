/**
 * 오버레이 카운터 레이어 마운트 게이팅
 * - outside 배치 요소만 카운터를 마운트한다
 * - inside/비활성 요소의 시그널 갱신은 레이어 커밋을 만들지 않는다
 */
import React, { Profiler, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import KeyCounterLayer from './KeyCounterLayer';
import StatCounterLayer from './StatCounterLayer';
import { setKeyActive } from '@stores/signals/keySignals';
import { setKeyCounter } from '@stores/signals/keyCounterSignals';
import { applyStatsSnapshot } from '@stores/signals/statsSignals';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const counterFor = (placement: 'inside' | 'outside', enabled = true) => ({
  enabled,
  placement,
});

let container: HTMLDivElement;
let root: Root;
let commits: number;
const onRender = (): void => {
  commits += 1;
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
  });
  commits = 0;
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe('KeyCounterLayer 게이팅', () => {
  const mode = 'layer-gate-mode';
  const keys = ['gate-inside', 'gate-outside', 'gate-disabled', 'gate-default'];
  const positions = [
    { dx: 0, dy: 0, width: 60, height: 60, counter: counterFor('inside') },
    { dx: 70, dy: 0, width: 60, height: 60, counter: counterFor('outside') },
    {
      dx: 140,
      dy: 0,
      width: 60,
      height: 60,
      counter: counterFor('outside', false),
    },
    { dx: 210, dy: 0, width: 60, height: 60 },
  ];

  const render = (): void => {
    act(() => {
      root.render(
        <Profiler id="key-layer" onRender={onRender}>
          <KeyCounterLayer keys={keys} positions={positions} mode={mode} />
        </Profiler>,
      );
    });
  };

  it('outside 배치 키만 카운터를 마운트한다', () => {
    render();
    expect(container.querySelectorAll('span.counter')).toHaveLength(1);
  });

  it('inside·비활성·기본값 키의 시그널 갱신은 커밋을 만들지 않는다', () => {
    render();
    commits = 0;

    act(() => setKeyCounter(mode, 'gate-inside', 3));
    act(() => setKeyActive('gate-inside', true));
    act(() => setKeyCounter(mode, 'gate-disabled', 3));
    act(() => setKeyCounter(mode, 'gate-default', 3));
    expect(commits).toBe(0);

    act(() => setKeyCounter(mode, 'gate-outside', 3));
    expect(commits).toBe(1);
    expect(container.querySelector('span.counter')?.textContent).toBe('3');
  });
});

describe('StatCounterLayer 게이팅', () => {
  const positions = [
    {
      dx: 0,
      dy: 0,
      width: 100,
      height: 40,
      statType: 'kps',
      counter: counterFor('inside'),
    },
    {
      dx: 0,
      dy: 50,
      width: 100,
      height: 40,
      statType: 'total',
      counter: counterFor('outside'),
    },
  ];

  const render = (): void => {
    act(() => {
      root.render(
        <Profiler id="stat-layer" onRender={onRender}>
          <StatCounterLayer positions={positions} />
        </Profiler>,
      );
    });
  };

  it('outside 배치 stat만 카운터를 마운트하고 무관한 틱은 커밋하지 않는다', () => {
    act(() => applyStatsSnapshot({ kps: 0, kpsAvg: 0, kpsMax: 0, total: 0 }));
    render();
    expect(container.querySelectorAll('span.counter')).toHaveLength(1);
    commits = 0;

    // inside stat(kps)만 바뀌는 틱
    act(() => applyStatsSnapshot({ kps: 5, kpsAvg: 0, kpsMax: 0, total: 0 }));
    expect(commits).toBe(0);

    act(() => applyStatsSnapshot({ kps: 5, kpsAvg: 0, kpsMax: 0, total: 9 }));
    expect(commits).toBe(1);
    expect(container.querySelector('span.counter')?.textContent).toBe('9');
  });
});
