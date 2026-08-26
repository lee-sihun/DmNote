// @vitest-environment jsdom
import React, { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGridViewStore } from '@stores/grid/useGridViewStore';
import { useGridZoomPan } from './useGridZoomPan';

const Harness = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const { panX, panY } = useGridZoomPan({
    mode: 'benchmark',
    containerRef,
    contentRef,
  });
  return (
    <div
      ref={containerRef}
      data-testid="container"
      data-pan-x={panX}
      data-pan-y={panY}
    >
      <div ref={contentRef} />
    </div>
  );
};

describe('useGridZoomPan frame coalescing', () => {
  let host: HTMLDivElement;
  let root: Root;
  let callbacks: Map<number, FrameRequestCallback>;
  let nextFrameId: number;

  beforeEach(async () => {
    callbacks = new Map();
    nextFrameId = 0;
    vi.stubGlobal(
      'requestAnimationFrame',
      (callback: FrameRequestCallback): number => {
        const id = ++nextFrameId;
        callbacks.set(id, callback);
        return id;
      },
    );
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
    useGridViewStore.setState({
      viewStates: { benchmark: { zoom: 1, panX: 0, panY: 0 } },
    });
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(<Harness />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const flushFrame = () => {
    const entries = [...callbacks.entries()];
    callbacks.clear();
    act(() => entries.forEach(([, callback]) => callback(performance.now())));
  };

  it('한 프레임의 wheel delta를 누적해 Store를 한 번만 갱신한다', () => {
    const updates: Array<{ panX: number; panY: number }> = [];
    const unsubscribe = useGridViewStore.subscribe((state) => {
      updates.push(state.getViewState('benchmark'));
    });
    const container = host.querySelector<HTMLElement>(
      '[data-testid="container"]',
    )!;

    container.dispatchEvent(
      new WheelEvent('wheel', { deltaX: 2, deltaY: 3, cancelable: true }),
    );
    container.dispatchEvent(
      new WheelEvent('wheel', { deltaX: 4, deltaY: 5, cancelable: true }),
    );

    expect(updates).toHaveLength(0);
    flushFrame();
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ panX: -6, panY: -8 });
    unsubscribe();
  });

  it('미들 버튼 pan은 최신 포인터 좌표만 프레임당 한 번 적용한다', () => {
    const updates: Array<{ panX: number; panY: number }> = [];
    const unsubscribe = useGridViewStore.subscribe((state) => {
      updates.push(state.getViewState('benchmark'));
    });
    const container = host.querySelector<HTMLElement>(
      '[data-testid="container"]',
    )!;

    container.dispatchEvent(
      new MouseEvent('mousedown', {
        button: 1,
        clientX: 10,
        clientY: 20,
        bubbles: true,
        cancelable: true,
      }),
    );
    document.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 14, clientY: 27 }),
    );
    document.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 22, clientY: 35 }),
    );

    expect(updates).toHaveLength(0);
    flushFrame();
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ panX: 12, panY: 15 });

    document.dispatchEvent(new MouseEvent('mouseup'));
    unsubscribe();
  });

  it('작은 wheel delta는 원본 좌표에 누적하고 화면 좌표만 픽셀 정렬한다', () => {
    const previousRatio = window.devicePixelRatio;
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: 2,
    });
    const container = host.querySelector<HTMLElement>(
      '[data-testid="container"]',
    )!;

    container.dispatchEvent(
      new WheelEvent('wheel', { deltaX: 0.2, cancelable: true }),
    );
    flushFrame();
    container.dispatchEvent(
      new WheelEvent('wheel', { deltaX: 0.2, cancelable: true }),
    );
    flushFrame();

    expect(
      useGridViewStore.getState().getViewState('benchmark').panX,
    ).toBeCloseTo(-0.4);
    expect(container.dataset.panX).toBe('-0.5');

    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: previousRatio,
    });
  });
});
