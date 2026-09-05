import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useEditStatePreviewStore } from '@stores/grid/useEditStatePreviewStore';
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
  useEditStatePreviewStore.setState({ entries: [] });
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

  it('Key와 Stat adapter가 각 anchor의 active/inactive 상태를 독립 구독한다', () => {
    const positions = [
      { id: 'key-preview-state', counter: outsideCounter },
      { id: 'stat-preview-state', counter: outsideCounter },
    ];

    act(() => {
      root.render(
        <>
          <KeyCounterPreviewLayer positions={[positions[0]]} />
          <StatCounterLayer positions={[positions[1]]} />
        </>,
      );
    });
    const states = () =>
      [...container.querySelectorAll<HTMLElement>('.counter')].map(
        (counter) => counter.dataset.counterState,
      );
    expect(states()).toEqual(['inactive', 'inactive']);

    act(() => {
      useEditStatePreviewStore
        .getState()
        .publish(101, { kind: 'key', id: positions[0].id }, 'active');
    });
    expect(states()).toEqual(['active', 'inactive']);

    act(() => {
      useEditStatePreviewStore
        .getState()
        .publish(102, { kind: 'stat', id: positions[1].id }, 'active');
    });
    expect(states()).toEqual(['inactive', 'active']);
  });

  it('두 layer와 face가 pointer-events, class, style, DOM 순서를 동일하게 유지한다', () => {
    const position = {
      id: 'counter-dom-contract',
      dx: 4,
      dy: 8,
      width: 60,
      height: 40,
      className: 'counter-face-class',
      counter: outsideCounter,
    };

    act(() => {
      root.render(
        <>
          <KeyCounterPreviewLayer positions={[position]} previewValue={7} />
          <StatCounterLayer positions={[position]} />
        </>,
      );
    });

    const layers = [...container.children] as HTMLElement[];
    expect(layers).toHaveLength(2);
    expect(layers.map((layer) => layer.className)).toEqual([
      'absolute inset-0 pointer-events-none',
      'absolute inset-0 pointer-events-none',
    ]);
    expect(layers.map((layer) => layer.getAttribute('style'))).toEqual([
      'z-index: var(--z-canvas-counter-preview);',
      'z-index: var(--z-canvas-counter-preview);',
    ]);

    const faces = layers.map((layer) => layer.firstElementChild as HTMLElement);
    expect(faces.map((face) => face.className)).toEqual([
      'pointer-events-none counter-face-class',
      'pointer-events-none counter-face-class',
    ]);
    expect(faces[0].getAttribute('style')).toBe(faces[1].getAttribute('style'));
    expect(
      faces.map((face) =>
        [...face.children].map((child) => child.tagName).join(','),
      ),
    ).toEqual(['SPAN', 'SPAN']);
  });
});
