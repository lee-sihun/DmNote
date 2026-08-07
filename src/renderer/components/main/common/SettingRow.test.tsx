// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingToggleRow } from './SettingRow';

describe('SettingToggleRow commit 전략', () => {
  let host: HTMLDivElement;
  let root: Root;
  let animationFrames: Map<number, FrameRequestCallback>;
  let nextAnimationFrameId: number;

  const getRow = () =>
    host.querySelector<HTMLButtonElement>('button[role="switch"]');

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

  it('기본 sync 전략은 행 클릭에서 즉시 콜백을 실행한다', () => {
    const onToggle = vi.fn();
    act(() =>
      root.render(
        <SettingToggleRow label="설정" checked={false} onToggle={onToggle} />,
      ),
    );

    act(() => getRow()?.click());

    expect(onToggle).toHaveBeenCalledOnce();
    expect(getRow()?.getAttribute('aria-checked')).toBe('false');
  });

  it('after-paint 전략은 행과 장식 체크박스 상태를 먼저 반영한다', async () => {
    const onToggle = vi.fn();
    act(() =>
      root.render(
        <SettingToggleRow
          label="설정"
          checked={false}
          onToggle={onToggle}
          commitStrategy="after-paint"
        />,
      ),
    );

    act(() => getRow()?.click());

    expect(getRow()?.getAttribute('aria-checked')).toBe('true');
    expect(
      host
        .querySelector<HTMLDivElement>('div[role="switch"]')
        ?.getAttribute('aria-checked'),
    ).toBe('true');
    expect(onToggle).not.toHaveBeenCalled();

    await flushDeferredCommit();
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('after-paint 연타는 canonical과 같은 최종 의도를 커밋하지 않는다', async () => {
    const onToggle = vi.fn();
    act(() =>
      root.render(
        <SettingToggleRow
          label="설정"
          checked={false}
          onToggle={onToggle}
          commitStrategy="after-paint"
        />,
      ),
    );

    act(() => {
      getRow()?.click();
      getRow()?.click();
    });

    expect(getRow()?.getAttribute('aria-checked')).toBe('false');
    await flushDeferredCommit();
    expect(onToggle).not.toHaveBeenCalled();
  });
});
