// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import GridMinimap from './GridMinimap';
import { useGridViewStore } from '@stores/grid/useGridViewStore';

describe('GridMinimap 연속 드래그', () => {
  let host: HTMLDivElement;
  let root: Root;
  let callbacks: Map<number, FrameRequestCallback>;
  let setPan: ReturnType<
    typeof vi.fn<(mode: string, panX: number, panY: number) => void>
  >;
  let originalSetPan: ReturnType<typeof useGridViewStore.getState>['setPan'];

  beforeEach(() => {
    callbacks = new Map();
    originalSetPan = useGridViewStore.getState().setPan;
    setPan = vi.fn<(mode: string, panX: number, panY: number) => void>();
    useGridViewStore.setState({ setPan });
    let nextId = 1;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const container = document.createElement('div');
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      width: 400,
      height: 300,
      left: 0,
      top: 0,
      right: 400,
      bottom: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    act(() => {
      root.render(
        <GridMinimap
          positions={[{ dx: 0, dy: 0, width: 60, height: 60 }]}
          zoom={1}
          panX={0}
          panY={0}
          containerRef={{ current: container }}
          mode="benchmark"
          visible
          onZoomIn={() => undefined}
          onZoomOut={() => undefined}
          onResetZoom={() => undefined}
        />,
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    useGridViewStore.setState({ setPan: originalSetPan });
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const surface = () =>
    host.querySelector<HTMLElement>('[data-grid-minimap-surface="true"]')!;

  it('한 프레임의 mousemove를 최신 좌표 한 번으로 병합한다', () => {
    act(() => {
      surface().dispatchEvent(
        new MouseEvent('mousedown', {
          clientX: 10,
          clientY: 10,
          bubbles: true,
          cancelable: true,
        }),
      );
      document.dispatchEvent(
        new MouseEvent('mousemove', { clientX: 20, clientY: 25 }),
      );
      document.dispatchEvent(
        new MouseEvent('mousemove', { clientX: 30, clientY: 35 }),
      );
    });

    expect(setPan).not.toHaveBeenCalled();
    expect(callbacks).toHaveLength(1);
    act(() => {
      const callback = [...callbacks.values()][0];
      callbacks.clear();
      callback(performance.now());
    });
    expect(setPan).toHaveBeenCalledTimes(1);
    expect(setPan).toHaveBeenCalledWith('benchmark', 150, 25);
    act(() => document.dispatchEvent(new MouseEvent('mouseup')));
  });

  it('프레임 전에 mouseup하면 마지막 좌표를 즉시 반영한다', () => {
    act(() => {
      surface().dispatchEvent(
        new MouseEvent('mousedown', {
          clientX: 10,
          clientY: 10,
          bubbles: true,
          cancelable: true,
        }),
      );
      document.dispatchEvent(
        new MouseEvent('mousemove', { clientX: 30, clientY: 35 }),
      );
      document.dispatchEvent(new MouseEvent('mouseup'));
    });

    expect(setPan).toHaveBeenCalledTimes(1);
    expect(callbacks).toHaveLength(0);
  });
});
