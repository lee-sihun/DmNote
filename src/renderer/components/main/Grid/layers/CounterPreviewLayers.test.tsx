import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import KeyCounterPreviewLayer from './KeyCounterPreviewLayer';
import StatCounterLayer from './StatCounterLayer';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const outsideCounter = {
  enabled: true,
  placement: 'outside' as const,
  align: 'bottom' as const,
  gap: 7,
  fill: { idle: '#123456', active: '#abcdef' },
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Grid 카운터 프리뷰 공용 표면', () => {
  it('Key와 Stat이 같은 outside 표면 계약을 사용하면서 값 규칙은 유지한다', () => {
    const position = {
      id: 'counter-surface',
      dx: 11,
      dy: 13,
      width: 71,
      height: 43,
      className: 'counter-surface-marker',
      counter: outsideCounter,
    };

    act(() => {
      root.render(
        <>
          <KeyCounterPreviewLayer positions={[position]} previewValue={3.75} />
          <StatCounterLayer positions={[position]} />
        </>,
      );
    });

    const counters = [...container.querySelectorAll<HTMLElement>('.counter')];
    expect(counters).toHaveLength(2);
    expect(counters.map((counter) => counter.textContent)).toEqual([
      '3.75',
      '0',
    ]);
    expect(counters.map((counter) => counter.dataset.counterState)).toEqual([
      'inactive',
      'inactive',
    ]);
    expect(
      counters.map((counter) =>
        counter.parentElement?.classList.contains('counter-surface-marker'),
      ),
    ).toEqual([true, true]);
    expect(counters[0].parentElement?.getAttribute('style')).toBe(
      counters[1].parentElement?.getAttribute('style'),
    );
  });

  it('hidden·inside 요소는 두 레이어 모두에서 마운트하지 않는다', () => {
    const insideCounter = { enabled: true, placement: 'inside' as const };
    const positions = [
      { id: 'hidden', hidden: true, counter: outsideCounter },
      { id: 'inside', counter: insideCounter },
    ];

    act(() => {
      root.render(
        <>
          <KeyCounterPreviewLayer positions={positions} />
          <StatCounterLayer positions={positions} />
        </>,
      );
    });

    expect(container.querySelector('.counter')).toBeNull();
  });
});
