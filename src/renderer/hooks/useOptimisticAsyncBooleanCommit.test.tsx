// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useOptimisticAsyncBooleanCommit } from './useOptimisticAsyncBooleanCommit';
import { drainPendingOptimisticCommits } from './pendingOptimisticCommits';

interface AsyncToggleHarnessProps {
  onCommit: (value: boolean) => Promise<void>;
  onError?: (error: unknown) => void;
}

const AsyncToggleHarness = ({ onCommit, onError }: AsyncToggleHarnessProps) => {
  const [canonicalValue, setCanonicalValue] = useState(false);
  const { value, toggle, flush } = useOptimisticAsyncBooleanCommit({
    canonicalValue,
    onCommit: async (nextValue) => {
      await onCommit(nextValue);
      setCanonicalValue(nextValue);
    },
    onError,
  });

  return (
    <>
      <button type="button" role="switch" aria-checked={value} onClick={toggle}>
        토글
      </button>
      <button type="button" data-flush="true" onClick={() => void flush()}>
        반영
      </button>
    </>
  );
};

describe('useOptimisticAsyncBooleanCommit', () => {
  let host: HTMLDivElement;
  let root: Root;
  let animationFrames: Map<number, FrameRequestCallback>;
  let nextAnimationFrameId: number;

  const getToggle = () =>
    host.querySelector<HTMLButtonElement>('[role="switch"]');

  const flushScheduledCommit = async () => {
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

  it('첫 paint 전에 시각 상태를 반영하고 성공까지 유지한다', async () => {
    let resolveCommit: (() => void) | undefined;
    const onCommit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCommit = resolve;
        }),
    );
    act(() => root.render(<AsyncToggleHarness onCommit={onCommit} />));

    act(() => getToggle()?.click());
    expect(getToggle()?.getAttribute('aria-checked')).toBe('true');
    expect(onCommit).not.toHaveBeenCalled();

    await flushScheduledCommit();
    expect(onCommit).toHaveBeenCalledWith(true);
    expect(getToggle()?.getAttribute('aria-checked')).toBe('true');

    await act(async () => resolveCommit?.());
    expect(getToggle()?.getAttribute('aria-checked')).toBe('true');
  });

  it('비동기 실패 시 canonical 상태로 rollback한다', async () => {
    const error = new Error('toggle failed');
    let rejectCommit: ((reason: unknown) => void) | undefined;
    const onError = vi.fn();
    const onCommit = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectCommit = reject;
        }),
    );
    act(() =>
      root.render(<AsyncToggleHarness onCommit={onCommit} onError={onError} />),
    );

    act(() => getToggle()?.click());
    await flushScheduledCommit();
    await act(async () => rejectCommit?.(error));

    expect(onError).toHaveBeenCalledWith(error);
    expect(getToggle()?.getAttribute('aria-checked')).toBe('false');
  });

  it('요청 중 연타를 직렬화하고 마지막 의도를 보존한다', async () => {
    const resolvers: Array<() => void> = [];
    const onCommit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    act(() => root.render(<AsyncToggleHarness onCommit={onCommit} />));

    act(() => getToggle()?.click());
    await flushScheduledCommit();
    act(() => getToggle()?.click());

    expect(getToggle()?.getAttribute('aria-checked')).toBe('false');
    expect(onCommit).toHaveBeenCalledTimes(1);

    await act(async () => resolvers[0]?.());
    expect(onCommit).toHaveBeenNthCalledWith(2, false);
    expect(getToggle()?.getAttribute('aria-checked')).toBe('false');

    await act(async () => resolvers[1]?.());
    expect(getToggle()?.getAttribute('aria-checked')).toBe('false');
  });

  it('paint 전 상쇄된 연타는 비동기 커밋을 생략한다', async () => {
    const onCommit = vi.fn(async () => undefined);
    act(() => root.render(<AsyncToggleHarness onCommit={onCommit} />));

    act(() => {
      getToggle()?.click();
      getToggle()?.click();
    });
    await flushScheduledCommit();

    expect(onCommit).not.toHaveBeenCalled();
    expect(getToggle()?.getAttribute('aria-checked')).toBe('false');
  });

  it('flush는 예약 프레임을 기다리지 않고 최신 의도를 커밋한다', async () => {
    const onCommit = vi.fn(async () => undefined);
    act(() => root.render(<AsyncToggleHarness onCommit={onCommit} />));

    act(() => getToggle()?.click());
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-flush="true"]')?.click();
    });

    expect(animationFrames.size).toBe(0);
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith(true);
    expect(getToggle()?.getAttribute('aria-checked')).toBe('true');
  });

  it('호스트 프레임이 멈춰도 전역 정산이 예약된 토글을 한 번 저장한다', async () => {
    const onCommit = vi.fn(async () => undefined);
    act(() => root.render(<AsyncToggleHarness onCommit={onCommit} />));
    act(() => getToggle()?.click());
    expect(onCommit).not.toHaveBeenCalled();

    await act(async () => {
      expect(drainPendingOptimisticCommits()).toBe(true);
    });

    expect(onCommit).toHaveBeenCalledExactlyOnceWith(true);
    expect(animationFrames.size).toBe(0);
    await flushScheduledCommit();
    expect(onCommit).toHaveBeenCalledOnce();
  });

  it('paint 전 unmount는 예약을 취소하고 최신 의도를 한 번 커밋한다', async () => {
    const onCommit = vi.fn(async () => undefined);
    const UnmountHarness = () => {
      const [mounted, setMounted] = useState(true);
      return (
        <>
          {mounted && <AsyncToggleHarness onCommit={onCommit} />}
          <button
            type="button"
            data-unmount="true"
            onClick={() => setMounted(false)}
          >
            제거
          </button>
        </>
      );
    };
    act(() => root.render(<UnmountHarness />));

    act(() => getToggle()?.click());
    expect(animationFrames.size).toBe(1);
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-unmount="true"]')?.click();
      await Promise.resolve();
    });

    expect(animationFrames.size).toBe(0);
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith(true);
    await act(async () => vi.runOnlyPendingTimersAsync());
    expect(onCommit).toHaveBeenCalledOnce();
  });
});
