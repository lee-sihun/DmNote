// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { useGridMarquee } from './useGridMarquee';

const Harness = () => {
  useGridMarquee({
    positions: {},
    statPositions: {},
    graphPositions: {},
    knobPositions: {},
    selectedKeyType: 'benchmark',
    pluginElements: [],
    clientToGridCoords: (x, y) => ({ x, y }),
  });
  return null;
};

describe('useGridMarquee frame coalescing', () => {
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
    useGridSelectionStore.setState({
      selectedElements: [],
      selectedGroupIds: [],
      isMarqueeSelecting: false,
      marqueeStart: null,
      marqueeEnd: null,
    });
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(<Harness />));
    act(() => useGridSelectionStore.getState().startMarqueeSelection(0, 0));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  const flushFrame = () => {
    const queued = [...callbacks.values()];
    callbacks.clear();
    act(() => queued.forEach((callback) => callback(performance.now())));
  };

  it('한 프레임의 mousemove를 최신 좌표 한 번으로 병합한다', () => {
    let marqueeUpdates = 0;
    const unsubscribe = useGridSelectionStore.subscribe((state, previous) => {
      if (state.marqueeEnd !== previous.marqueeEnd) marqueeUpdates += 1;
    });

    document.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 10, clientY: 20 }),
    );
    document.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 30, clientY: 40 }),
    );

    expect(marqueeUpdates).toBe(0);
    flushFrame();
    expect(marqueeUpdates).toBe(1);
    expect(useGridSelectionStore.getState().marqueeEnd).toEqual({
      x: 30,
      y: 40,
    });
    unsubscribe();
  });

  it('mouseup 전에 예약된 마지막 좌표를 flush한다', () => {
    document.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 25, clientY: 35 }),
    );
    expect(callbacks.size).toBe(1);

    act(() => document.dispatchEvent(new MouseEvent('mouseup')));

    expect(callbacks.size).toBe(0);
    expect(useGridSelectionStore.getState().isMarqueeSelecting).toBe(false);
  });

  it('컨텍스트 메뉴가 열리면 마퀴를 취소하되 기존 선택은 남긴다', () => {
    const kept = [{ type: 'key' as const, id: 'key-1', index: 0 }];
    act(() => useGridSelectionStore.setState({ selectedElements: kept }));
    act(() =>
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })),
    );
    expect(callbacks.size).toBe(1);

    // 메뉴가 열리기 전에 끝나야 하므로 캡처 단계를 쓴다.
    // 중첩 노드에서 올려야 캡처와 버블이 구분된다
    act(() =>
      host.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })),
    );

    expect(useGridSelectionStore.getState()).toMatchObject({
      isMarqueeSelecting: false,
      marqueeStart: null,
      marqueeEnd: null,
    });
    // 취소는 확정과 다르다 - 예약된 프레임을 버리고 선택을 건드리지 않는다
    expect(callbacks.size).toBe(0);
    expect(useGridSelectionStore.getState().selectedElements).toEqual(kept);
  });

  it('창이 포커스를 잃으면 마퀴를 취소하되 기존 선택은 남긴다', () => {
    const kept = [{ type: 'key' as const, id: 'key-1', index: 0 }];
    act(() => useGridSelectionStore.setState({ selectedElements: kept }));

    act(() => window.dispatchEvent(new Event('blur')));

    expect(useGridSelectionStore.getState()).toMatchObject({
      isMarqueeSelecting: false,
      marqueeStart: null,
      marqueeEnd: null,
    });
    expect(useGridSelectionStore.getState().selectedElements).toEqual(kept);
  });
});
