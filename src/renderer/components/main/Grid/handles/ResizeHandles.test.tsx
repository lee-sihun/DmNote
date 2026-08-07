// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ResizeHandles from './ResizeHandles';

describe('ResizeHandles frame coalescing', () => {
  let host: HTMLDivElement;
  let root: Root;
  let callbacks: Map<number, FrameRequestCallback>;

  beforeEach(() => {
    callbacks = new Map();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.set(1, callback);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('mousemove burst의 최신 bounds만 한 번 preview한다', async () => {
    const onResize = vi.fn();
    await act(async () => {
      root.render(
        <ResizeHandles
          bounds={{ x: 0, y: 0, width: 100, height: 100 }}
          onResize={onResize}
        />,
      );
    });
    const handle = host.querySelector<HTMLElement>(
      '[data-resize-handle="se"]',
    )!;
    act(() =>
      handle.dispatchEvent(
        new MouseEvent('mousedown', {
          clientX: 0,
          clientY: 0,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );

    document.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 10, clientY: 10 }),
    );
    document.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 20, clientY: 30 }),
    );
    expect(onResize).not.toHaveBeenCalled();

    const callback = callbacks.get(1)!;
    callbacks.clear();
    act(() => callback(performance.now()));
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResize.mock.calls[0][0]).toMatchObject({
      width: 120,
      height: 130,
    });
    act(() => document.dispatchEvent(new MouseEvent('mouseup')));
  });

  it('mouseup은 예약된 마지막 bounds를 flush한다', async () => {
    const onResize = vi.fn();
    const onResizeEnd = vi.fn();
    await act(async () => {
      root.render(
        <ResizeHandles
          bounds={{ x: 0, y: 0, width: 100, height: 100 }}
          onResize={onResize}
          onResizeEnd={onResizeEnd}
        />,
      );
    });
    const handle = host.querySelector<HTMLElement>(
      '[data-resize-handle="se"]',
    )!;
    act(() =>
      handle.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    document.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 25, clientY: 15 }),
    );

    act(() => document.dispatchEvent(new MouseEvent('mouseup')));

    expect(callbacks.size).toBe(0);
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResizeEnd).toHaveBeenCalledTimes(1);
  });
});
