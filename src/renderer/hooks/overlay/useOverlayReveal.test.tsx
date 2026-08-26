import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginPluginWork,
  noteEnabledPluginCount,
  noteMainPluginsReady,
  notePluginFetchSettled,
  resetPluginRuntimeReadiness,
} from '@plugins/runtime/pluginRuntimeReadiness';
import { useOverlayReveal } from './useOverlayReveal';

let lastRevealed: boolean | null = null;

const Harness = ({
  isBootstrapped,
  resizePending,
}: {
  isBootstrapped: boolean;
  resizePending: boolean;
}) => {
  const revealed = useOverlayReveal(isBootstrapped, resizePending);
  React.useEffect(() => {
    lastRevealed = revealed;
  });
  return null;
};

// 초기 조회 2건 완료 = 로컬 런타임 준비
const settleLocalRuntime = () => {
  notePluginFetchSettled();
  notePluginFetchSettled();
};

describe('useOverlayReveal', () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = (isBootstrapped: boolean, resizePending = false) => {
    act(() => {
      root.render(
        <Harness
          isBootstrapped={isBootstrapped}
          resizePending={resizePending}
        />,
      );
    });
  };

  const flush = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    // rAF를 타이머로 대체해 페인트 대기를 결정적으로 진행
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
      setTimeout(() => cb(0), 16),
    );
    vi.stubGlobal('cancelAnimationFrame', (handle: number) =>
      clearTimeout(handle as unknown as NodeJS.Timeout),
    );
    resetPluginRuntimeReadiness();
    lastRevealed = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await vi.runAllTimersAsync();
    });
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    resetPluginRuntimeReadiness();
  });

  it('부트스트랩 전에는 리빌하지 않는다', async () => {
    settleLocalRuntime();
    render(false);
    await flush(100);

    expect(lastRevealed).toBe(false);
  });

  it('플러그인이 없으면 메인을 기다리지 않고 리빌한다', async () => {
    settleLocalRuntime();
    noteEnabledPluginCount(0);
    render(true);
    await flush(100);

    expect(lastRevealed).toBe(true);
  });

  it('활성 플러그인이 있으면 메인 준비 신호까지 기다린다', async () => {
    settleLocalRuntime();
    noteEnabledPluginCount(1);
    render(true);
    await flush(100);
    expect(lastRevealed).toBe(false);

    act(() => {
      noteMainPluginsReady();
    });
    await flush(100);

    expect(lastRevealed).toBe(true);
  });

  it('로컬 런타임 작업이 남아 있으면 리빌하지 않는다', async () => {
    const endWork = beginPluginWork();
    settleLocalRuntime();
    noteEnabledPluginCount(0);
    render(true);
    await flush(100);
    expect(lastRevealed).toBe(false);

    act(() => {
      endWork();
    });
    await flush(100);

    expect(lastRevealed).toBe(true);
  });

  it('리사이즈 응답이 남아 있으면 리빌을 미룬다', async () => {
    settleLocalRuntime();
    noteEnabledPluginCount(0);
    render(true, true);
    await flush(100);
    expect(lastRevealed).toBe(false);

    render(true, false);
    await flush(100);

    expect(lastRevealed).toBe(true);
  });

  it('조건이 끝내 충족되지 않아도 데드라인에 리빌한다', async () => {
    render(false);
    await flush(2000);
    expect(lastRevealed).toBe(false);

    await flush(1000);

    expect(lastRevealed).toBe(true);
  });

  it('리빌은 1회성이라 이후 조건 변화로 되돌아가지 않는다', async () => {
    settleLocalRuntime();
    noteEnabledPluginCount(0);
    render(true);
    await flush(100);
    expect(lastRevealed).toBe(true);

    render(true, true);
    await flush(100);
    expect(lastRevealed).toBe(true);

    act(() => {
      resetPluginRuntimeReadiness();
    });
    await flush(100);
    expect(lastRevealed).toBe(true);
  });
});
