// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GraphPanel from './GraphPanel';

describe('GraphPanel history animation', () => {
  let host: HTMLDivElement;
  let root: Root;
  let nextFrameId: number;
  let now: number;
  let frames: Map<number, FrameRequestCallback>;
  let cancelFrame: ReturnType<typeof vi.fn>;

  const renderGraph = async (
    graphType: 'line' | 'bar',
    history: number[],
    animationEnabled = true,
  ) => {
    await act(async () => {
      root.render(
        <GraphPanel
          graphType={graphType}
          history={history}
          animationEnabled={animationEnabled}
          maxval={20}
          uid="animation-contract"
        />,
      );
    });
  };

  const runNextFrame = async (timestamp: number) => {
    const entry = frames.entries().next().value as
      | [number, FrameRequestCallback]
      | undefined;
    expect(entry).toBeDefined();
    const [id, callback] = entry!;
    frames.delete(id);
    await act(async () => callback(timestamp));
  };

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    nextFrameId = 1;
    now = 1_000;
    frames = new Map();
    cancelFrame = vi.fn((id: number) => {
      frames.delete(id);
    });
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextFrameId;
      nextFrameId += 1;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', cancelFrame);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('line history를 cubic ease-out으로 진행하고 목표값에서 종료한다', async () => {
    await renderGraph('line', [0, 0]);
    await renderGraph('line', [10, 20]);

    expect(frames.size).toBe(1);
    await runNextFrame(1_075);
    expect(host.querySelector('polyline')?.getAttribute('points')).toBe(
      '0,56.25 100,12.5',
    );
    expect(frames.size).toBe(1);

    await runNextFrame(1_150);
    expect(host.querySelector('polyline')?.getAttribute('points')).toBe(
      '0,50 100,0',
    );
    expect(frames.size).toBe(0);
  });

  it('그래프 종류 전환은 이전 frame을 취소하고 새 종류의 보간을 시작한다', async () => {
    await renderGraph('line', [0, 0]);
    await renderGraph('line', [10, 20]);
    const lineFrameId = [...frames.keys()][0];

    now = 2_000;
    await renderGraph('bar', [20, 10]);

    expect(cancelFrame).toHaveBeenCalledWith(lineFrameId);
    expect(frames.size).toBe(1);
    expect(host.querySelector('path')).not.toBeNull();
  });

  it('animation 비활성화와 unmount는 대기 frame을 취소한다', async () => {
    await renderGraph('bar', [0, 0]);
    await renderGraph('bar', [10, 20]);
    const activeFrameId = [...frames.keys()][0];

    await renderGraph('bar', [10, 20], false);
    expect(cancelFrame).toHaveBeenCalledWith(activeFrameId);
    expect(frames.size).toBe(0);

    await renderGraph('bar', [20, 10], false);
    expect(frames.size).toBe(0);

    await renderGraph('bar', [10, 20]);
    const unmountFrameId = [...frames.keys()][0];
    await act(async () => root.unmount());
    expect(cancelFrame).toHaveBeenCalledWith(unmountFrameId);
    expect(frames.size).toBe(0);
    root = createRoot(host);
  });
});
