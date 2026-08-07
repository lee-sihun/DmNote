// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TabSwitch from './TabSwitch';

const TABS = [
  { id: 'first', label: '첫 번째' },
  { id: 'second', label: '두 번째' },
  { id: 'third', label: '세 번째' },
];

describe('TabSwitch commit 전략', () => {
  let host: HTMLDivElement;
  let root: Root;
  let animationFrames: Map<number, FrameRequestCallback>;
  let nextAnimationFrameId: number;

  const getTab = (id: string) =>
    host.querySelector<HTMLButtonElement>(`[data-tab-id="${id}"]`);

  const flushDeferredCommit = async () => {
    const callbacks = [...animationFrames.values()];
    animationFrames.clear();
    act(() => callbacks.forEach((callback) => callback(performance.now())));
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

  it('기본 sync 전략은 탭 클릭에서 즉시 콜백을 실행한다', () => {
    const onTabChange = vi.fn();
    act(() =>
      root.render(
        <TabSwitch tabs={TABS} activeTab="first" onTabChange={onTabChange} />,
      ),
    );

    act(() => getTab('second')?.click());

    expect(onTabChange).toHaveBeenCalledWith('second');
    expect(getTab('first')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('after-paint 전략은 활성 탭 표시를 먼저 반영한다', async () => {
    const onTabChange = vi.fn();
    act(() =>
      root.render(
        <TabSwitch
          tabs={TABS}
          activeTab="first"
          onTabChange={onTabChange}
          commitStrategy="after-paint"
        />,
      ),
    );

    act(() => getTab('second')?.click());

    expect(getTab('second')?.getAttribute('aria-pressed')).toBe('true');
    expect(onTabChange).not.toHaveBeenCalled();

    await flushDeferredCommit();
    expect(onTabChange).toHaveBeenCalledWith('second');
  });

  it('paint 전 연속 선택은 마지막 탭만 커밋한다', async () => {
    const onTabChange = vi.fn();
    act(() =>
      root.render(
        <TabSwitch
          tabs={TABS}
          activeTab="first"
          onTabChange={onTabChange}
          commitStrategy="after-paint"
        />,
      ),
    );

    act(() => {
      getTab('second')?.click();
      getTab('third')?.click();
    });

    expect(getTab('third')?.getAttribute('aria-pressed')).toBe('true');
    await flushDeferredCommit();
    expect(onTabChange).toHaveBeenCalledOnce();
    expect(onTabChange).toHaveBeenCalledWith('third');
  });

  it('paint 전 언마운트에도 마지막 탭 선택을 보존한다', () => {
    const onTabChange = vi.fn();
    act(() =>
      root.render(
        <TabSwitch
          tabs={TABS}
          activeTab="first"
          onTabChange={onTabChange}
          commitStrategy="after-paint"
        />,
      ),
    );

    act(() => getTab('second')?.click());
    act(() => root.render(null));

    expect(onTabChange).toHaveBeenCalledWith('second');
  });
});
