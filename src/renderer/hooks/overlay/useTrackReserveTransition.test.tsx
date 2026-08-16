import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useTrackReserveTransition,
  type ContentFadeStyle,
} from './useTrackReserveTransition';

const { transitionFade } = vi.hoisted(() => ({
  transitionFade:
    vi.fn<(alpha: number, durationMs: number) => Promise<boolean>>(),
}));

vi.mock('@api/modules/overlayApi', () => ({
  overlayApi: { transitionFade },
}));

let lastResult: {
  trackHeight: number;
  contentFade: ContentFadeStyle | null;
} | null = null;

const Harness = ({
  target,
  hydrated,
}: {
  target: number;
  hydrated: boolean;
}) => {
  lastResult = useTrackReserveTransition(target, hydrated);
  return null;
};

describe('useTrackReserveTransition', () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = (target: number, hydrated: boolean) => {
    act(() => {
      root.render(<Harness target={target} hydrated={hydrated} />);
    });
  };

  const flush = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    transitionFade.mockReset();
    transitionFade.mockResolvedValue(true);
    lastResult = null;
    delete window.__dmn_runtime;
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
    vi.useRealTimers();
  });

  it('하이드레이션 전 값 변화는 전환 없이 같은 패스에서 채택한다', () => {
    render(0, false);
    expect(lastResult?.trackHeight).toBe(0);

    render(300, false);
    expect(lastResult?.trackHeight).toBe(300);
    expect(transitionFade).not.toHaveBeenCalled();
  });

  it('네이티브 페이드 지원 시 페이드아웃 후 값을 바꾸고 페이드인한다', async () => {
    render(300, true);
    render(0, true);

    await flush(0);
    expect(transitionFade).toHaveBeenNthCalledWith(1, 0, 80);
    // 페이드아웃이 끝나기 전에는 이전 값 유지
    expect(lastResult?.trackHeight).toBe(300);

    await flush(100);
    expect(lastResult?.trackHeight).toBe(0);

    await flush(160);
    expect(transitionFade).toHaveBeenNthCalledWith(2, 1, 140);
    expect(transitionFade).toHaveBeenCalledTimes(2);
    // 네이티브 경로에서는 콘텐츠 페이드 미사용
    expect(lastResult?.contentFade).toBeNull();
  });

  it('네이티브 미지원(false) 시 콘텐츠 페이드로 대체하고 알파 복구도 호출한다', async () => {
    transitionFade.mockImplementation(async (alpha) => {
      if (alpha === 0) return false;
      return true;
    });
    render(300, true);
    render(0, true);

    await flush(0);
    expect(lastResult?.contentFade).toEqual({ opacity: 0, durationMs: 80 });

    await flush(100);
    expect(lastResult?.trackHeight).toBe(0);

    await flush(160);
    // 알파 복구 벨트는 미지원 환경에서도 호출된다
    expect(transitionFade).toHaveBeenCalledWith(1, 140);
    expect(lastResult?.contentFade).toEqual({ opacity: 1, durationMs: 140 });

    // 페이드인 완료 후 인라인 opacity 제거
    await flush(200);
    expect(lastResult?.contentFade).toBeNull();
  });

  it('전환 중 재토글 시 마지막 런만 페이드인을 소유한다', async () => {
    render(300, true);
    render(0, true);
    await flush(20);
    render(300, true);

    await flush(1000);
    const fadeInCalls = transitionFade.mock.calls.filter(
      ([alpha]) => alpha === 1,
    );
    expect(fadeInCalls).toHaveLength(1);
    expect(lastResult?.trackHeight).toBe(300);
  });

  it('페이드 중 언마운트해도 알파를 복구한다', async () => {
    render(300, true);
    render(0, true);
    await flush(20);

    await act(async () => {
      root.unmount();
      await vi.runAllTimersAsync();
    });
    const fadeInCalls = transitionFade.mock.calls.filter(
      ([alpha]) => alpha === 1,
    );
    expect(fadeInCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('페이드 호출이 거부돼도 값은 전환되고 복구가 시도된다', async () => {
    transitionFade.mockImplementation(async (alpha) => {
      if (alpha === 0) throw new Error('gone');
      return true;
    });
    render(300, true);
    render(0, true);

    await flush(500);
    expect(lastResult?.trackHeight).toBe(0);
    expect(transitionFade).toHaveBeenCalledWith(1, 140);
  });

  it('예약이 유지되는 값 변경은 페이드 없이 즉시 반영한다', () => {
    render(300, true);
    render(250, true);
    expect(lastResult?.trackHeight).toBe(250);
    expect(transitionFade).not.toHaveBeenCalled();
  });

  it('OBS 런타임에서는 전환 없이 즉시 반영한다', async () => {
    window.__dmn_runtime = 'obs';
    render(300, true);
    render(0, true);

    await flush(0);
    expect(lastResult?.trackHeight).toBe(0);
    expect(transitionFade).not.toHaveBeenCalled();
    expect(lastResult?.contentFade).toBeNull();
  });
});
