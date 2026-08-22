// @vitest-environment jsdom
import React, { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGridViewStore } from '@stores/grid/useGridViewStore';
import { useSettingsStore } from '@stores/useSettingsStore';
import { registerPopupLayer } from '@components/main/Modal/popupLayer';
import { useGridZoomPan } from './useGridZoomPan';
import type { ShortcutsState } from '@src/types/settings/shortcuts';

const Harness = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useGridZoomPan({ mode: 'benchmark', containerRef, contentRef });
  return (
    <div ref={containerRef} data-testid="container">
      <div ref={contentRef} />
    </div>
  );
};

describe('useGridZoomPan frame coalescing', () => {
  let host: HTMLDivElement;
  let root: Root;
  let callbacks: Map<number, FrameRequestCallback>;
  let nextFrameId: number;
  let previousShortcuts: ShortcutsState;
  const layerCleanups: Array<() => void> = [];

  beforeEach(async () => {
    previousShortcuts = useSettingsStore.getState().shortcuts;
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
    await act(async () =>
      layerCleanups
        .splice(0)
        .reverse()
        .forEach((cleanup) => cleanup()),
    );
    await act(async () => root.unmount());
    useSettingsStore.setState({ shortcuts: previousShortcuts });
    host.remove();
    document
      .querySelectorAll('[data-dmn-modal-backdrop="true"]')
      .forEach((element) => element.remove());
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const flushFrame = () => {
    const entries = [...callbacks.entries()];
    callbacks.clear();
    act(() => entries.forEach(([, callback]) => callback(performance.now())));
  };

  const registerModal = async () => {
    const modal = document.createElement('div');
    modal.dataset.dmnModalBackdrop = 'true';
    document.body.appendChild(modal);
    let unregister = () => {};
    await act(async () => {
      unregister = registerPopupLayer(modal);
      layerCleanups.push(unregister);
    });
    return unregister;
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

    act(() => document.dispatchEvent(new MouseEvent('mouseup')));
    unsubscribe();
  });

  it('활성 모달 동안 줌 단축키를 차단하고 종료 후 복원한다', async () => {
    await act(async () => {
      useSettingsStore.setState({
        shortcuts: {
          ...previousShortcuts,
          resetZoom: { key: 'KeyQ' },
        },
      });
      useGridViewStore.getState().setZoom('benchmark', 2);
    });

    const unregister = await registerModal();

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'q',
          code: 'KeyQ',
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(useGridViewStore.getState().getViewState('benchmark').zoom).toBe(2);

    await act(async () => unregister());
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'q',
          code: 'KeyQ',
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(useGridViewStore.getState().getViewState('benchmark').zoom).toBe(1);
  });

  it('모달 직전에 예약된 wheel frame을 폐기한다', async () => {
    const container = host.querySelector<HTMLElement>(
      '[data-testid="container"]',
    )!;
    container.dispatchEvent(
      new WheelEvent('wheel', {
        deltaX: 7,
        deltaY: 9,
        cancelable: true,
      }),
    );
    expect(callbacks).toHaveLength(1);

    await registerModal();
    flushFrame();

    expect(useGridViewStore.getState().getViewState('benchmark')).toMatchObject(
      { zoom: 1, panX: 0, panY: 0 },
    );
  });

  it('진행 중인 middle pan의 예약 frame도 모달 진입 시 폐기한다', async () => {
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
      new MouseEvent('mousemove', { clientX: 30, clientY: 45 }),
    );
    expect(callbacks).toHaveLength(1);

    await registerModal();
    flushFrame();

    expect(useGridViewStore.getState().getViewState('benchmark')).toMatchObject(
      { zoom: 1, panX: 0, panY: 0 },
    );
    act(() => document.dispatchEvent(new MouseEvent('mouseup')));
  });
});
