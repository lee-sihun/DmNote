/**
 * inside 카운터 시그널 구독 격리
 * - 카운터 값 갱신은 Key/StatItem 본문을 다시 실행하지 않고 CountDisplay만 갱신한다
 * - active 토글은 여전히 Key를 리렌더하되 재생 중 팝 애니메이션을 끊지 않는다
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Key } from '@components/shared/Key';
import StatItem from './StatItem';
import { setKeyActive } from '@stores/signals/keySignals';
import {
  resetAllCounters,
  setKeyCounter,
} from '@stores/signals/keyCounterSignals';
import { applyStatsSnapshot } from '@stores/signals/statsSignals';

const styleCalls = vi.hoisted(() => ({ count: 0 }));

// Key/StatItem 본문 실행 횟수 프록시 — 렌더마다 반드시 호출되는 스타일 계산을 감싼다
vi.mock('@hooks/overlay/useKeyElementStyles', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('@hooks/overlay/useKeyElementStyles')
  >();
  return {
    ...original,
    computeKeyElementStyles: (
      ...args: Parameters<typeof original.computeKeyElementStyles>
    ) => {
      styleCalls.count += 1;
      return original.computeKeyElementStyles(...args);
    },
  };
});

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// 기본값은 애니메이션 off — 팝 시작 횟수를 검증하기 위해 켠다
const insideCounter = {
  enabled: true,
  placement: 'inside',
  animation: { enabled: true },
};

let container: HTMLDivElement;
let root: Root;
let animateCalls: number;
let cancelCalls: number;
const proto = Element.prototype as unknown as { animate?: unknown };
const originalAnimate = proto.animate;

beforeEach(() => {
  animateCalls = 0;
  cancelCalls = 0;
  proto.animate = () => {
    animateCalls += 1;
    return {
      cancel: () => {
        cancelCalls += 1;
      },
    };
  };
  // 시그널 Map은 모듈 전역 — 테스트 순서에 따라 count 변경 여부가 달라지지 않도록 리셋
  resetAllCounters();
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
  });
  styleCalls.count = 0;
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  if (originalAnimate) proto.animate = originalAnimate;
  else delete proto.animate;
});

const counterText = (): string | null =>
  container.querySelector('span.counter')?.textContent ?? null;

describe('Key inside 카운터', () => {
  const mode = 'sub-mode';
  const key = 'sub-key';

  const renderKey = (): void => {
    act(() => {
      root.render(
        <Key
          keyName="A"
          globalKey={key}
          mode={mode}
          counterEnabled
          position={{
            dx: 0,
            dy: 0,
            width: 60,
            height: 60,
            counter: insideCounter,
          }}
        />,
      );
    });
  };

  it('카운터 갱신은 Key 본문을 다시 실행하지 않고 숫자만 바꾼다', () => {
    renderKey();
    const afterMount = styleCalls.count;

    act(() => setKeyCounter(mode, key, 7));
    expect(counterText()).toBe('7');
    expect(styleCalls.count).toBe(afterMount);

    act(() => setKeyCounter(mode, key, 8));
    expect(counterText()).toBe('8');
    expect(styleCalls.count).toBe(afterMount);
  });

  it('active 토글은 Key를 리렌더하지만 카운터 팝은 count 변경 1회만 시작한다', () => {
    renderKey();
    const afterMount = styleCalls.count;
    animateCalls = 0;

    act(() => setKeyActive(key, true));
    act(() => setKeyCounter(mode, key, 9));
    act(() => setKeyActive(key, false));

    expect(styleCalls.count).toBe(afterMount + 2);
    expect(counterText()).toBe('9');
    expect(animateCalls).toBe(1);
    // active 변경 커밋이 재생 중 팝을 취소하지 않는다
    expect(cancelCalls).toBe(0);
  });
});

describe('StatItem inside 카운터', () => {
  const renderStat = (): void => {
    act(() => {
      root.render(
        <StatItem
          statType="total"
          label="Total"
          counterEnabled
          position={{
            dx: 0,
            dy: 0,
            width: 100,
            height: 40,
            counter: insideCounter,
          }}
        />,
      );
    });
  };

  it('stat 갱신은 StatItem 본문을 다시 실행하지 않고 숫자만 바꾼다', () => {
    act(() => applyStatsSnapshot({ kps: 0, kpsAvg: 0, kpsMax: 0, total: 0 }));
    renderStat();
    const afterMount = styleCalls.count;

    act(() => applyStatsSnapshot({ kps: 3, kpsAvg: 1, kpsMax: 3, total: 12 }));
    expect(counterText()).toBe('12');
    expect(styleCalls.count).toBe(afterMount);
  });
});
