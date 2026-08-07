// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Checkbox from './Checkbox';

describe('Checkbox commit 전략', () => {
  let host: HTMLDivElement;
  let root: Root;
  let animationFrames: Map<number, FrameRequestCallback>;
  let nextAnimationFrameId: number;

  const flushDeferredCommit = async () => {
    const callbacks = [...animationFrames.values()];
    animationFrames.clear();
    act(() => {
      callbacks.forEach((callback) => callback(performance.now()));
    });
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    animationFrames = new Map();
    nextAnimationFrameId = 1;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextAnimationFrameId;
      nextAnimationFrameId += 1;
      animationFrames.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      animationFrames.delete(id);
    });
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('기본 sync 전략은 클릭 태스크에서 즉시 콜백을 실행한다', () => {
    const onChange = vi.fn();
    act(() => root.render(<Checkbox checked={false} onChange={onChange} />));

    act(() => host.querySelector<HTMLElement>('[role="switch"]')?.click());

    expect(onChange).toHaveBeenCalledOnce();
    expect(
      host.querySelector('[role="switch"]')?.getAttribute('aria-checked'),
    ).toBe('false');
  });

  it('after-paint 전략은 시각 상태를 먼저 반영하고 콜백을 미룬다', async () => {
    const onChange = vi.fn();
    act(() =>
      root.render(
        <Checkbox
          checked={false}
          onChange={onChange}
          commitStrategy="after-paint"
        />,
      ),
    );

    act(() => host.querySelector<HTMLElement>('[role="switch"]')?.click());

    expect(
      host.querySelector('[role="switch"]')?.getAttribute('aria-checked'),
    ).toBe('true');
    expect(onChange).not.toHaveBeenCalled();

    await flushDeferredCommit();
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('after-paint 연타의 최종 값이 canonical과 같으면 커밋하지 않는다', async () => {
    const onChange = vi.fn();
    act(() =>
      root.render(
        <Checkbox
          checked={false}
          onChange={onChange}
          commitStrategy="after-paint"
        />,
      ),
    );

    const toggle = host.querySelector<HTMLElement>('[role="switch"]');
    act(() => {
      toggle?.click();
      toggle?.click();
    });

    expect(toggle?.getAttribute('aria-checked')).toBe('false');
    await flushDeferredCommit();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('paint 전 언마운트에도 마지막 사용자 의도를 보존한다', () => {
    const onChange = vi.fn();
    act(() =>
      root.render(
        <Checkbox
          checked={false}
          onChange={onChange}
          commitStrategy="after-paint"
        />,
      ),
    );

    act(() => host.querySelector<HTMLElement>('[role="switch"]')?.click());
    act(() => root.render(null));

    expect(onChange).toHaveBeenCalledOnce();
  });
});
