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
});

describe('useGridMarquee 빈 공간 프레스', () => {
  let host: HTMLDivElement;
  let root: Root;
  const apiRef: { current: ReturnType<typeof useGridMarquee> | null } = {
    current: null,
  };

  const ApiHarness = () => {
    const api = useGridMarquee({
      positions: {},
      statPositions: {},
      graphPositions: {},
      knobPositions: {},
      selectedKeyType: 'benchmark',
      pluginElements: [],
      clientToGridCoords: (x, y) => ({ x, y }),
    });
    // 렌더 중 외부 값 변경 금지(React Compiler) - 커밋 후 노출
    React.useEffect(() => {
      apiRef.current = api;
    });
    return null;
  };

  beforeEach(async () => {
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
    await act(async () => root.render(<ApiHarness />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    apiRef.current = null;
  });

  it('마퀴 시작(프레스)이 기존 선택을 즉시 해제한다', () => {
    useGridSelectionStore.setState({
      selectedElements: [{ type: 'key', id: 'k-1', index: 0 }],
    });
    act(() => apiRef.current?.startMarqueeSelection(0, 0));
    // mouseup까지 기다리지 않고 프레스 시점에 비워져 피커 닫힘과 한 프레임
    expect(useGridSelectionStore.getState().selectedElements).toEqual([]);
    expect(useGridSelectionStore.getState().isMarqueeSelecting).toBe(true);
    act(() => document.dispatchEvent(new MouseEvent('mouseup')));
    expect(useGridSelectionStore.getState().isMarqueeSelecting).toBe(false);
  });

  it('편집 입력이 포커스면 프레스 해제를 건너뛰고 mouseup 정산이 비운다', () => {
    useGridSelectionStore.setState({
      selectedElements: [{ type: 'key', id: 'k-1', index: 0 }],
    });
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    try {
      act(() => apiRef.current?.startMarqueeSelection(0, 0));
      // 프레스 시점에 비우면 입력이 blur 전에 언마운트돼 draft가 사라진다
      expect(useGridSelectionStore.getState().selectedElements).toEqual([
        { type: 'key', id: 'k-1', index: 0 },
      ]);
      expect(useGridSelectionStore.getState().isMarqueeSelecting).toBe(true);
      act(() => document.dispatchEvent(new MouseEvent('mouseup')));
      // 작은 마퀴(클릭) 정산이 선택을 비운다
      expect(useGridSelectionStore.getState().selectedElements).toEqual([]);
      expect(useGridSelectionStore.getState().isMarqueeSelecting).toBe(false);
    } finally {
      input.remove();
    }
  });
});
