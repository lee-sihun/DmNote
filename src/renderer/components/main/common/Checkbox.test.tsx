// @vitest-environment jsdom
import React, { act } from 'react';
import { readFileSync } from 'node:fs';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Checkbox from './Checkbox';

const pxOf = (className: string, pattern: RegExp) => {
  const match = className.match(pattern);
  if (!match) throw new Error(`치수를 찾지 못함: ${pattern} in ${className}`);
  return Number(match[1]);
};

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

  it('노브 이동을 CSS가 잡을 수 있게 시각 상태와 훅을 노출한다', () => {
    act(() => root.render(<Checkbox checked={false} onChange={vi.fn()} />));
    const track = host.querySelector<HTMLElement>('[role="switch"]');
    expect(host.querySelector('.dmn-toggle-thumb')).not.toBeNull();
    expect(track?.getAttribute('aria-checked')).toBe('false');

    act(() => root.render(<Checkbox checked={true} onChange={vi.fn()} />));
    expect(track?.getAttribute('aria-checked')).toBe('true');
  });

  it('이동량 토큰이 트랙·노브 치수와 맞는다', () => {
    act(() => root.render(<Checkbox checked={false} onChange={vi.fn()} />));
    const track = host.querySelector<HTMLElement>('[role="switch"]')!;
    const thumb = host.querySelector<HTMLElement>('.dmn-toggle-thumb')!;
    const trackWidth = pxOf(track.className, /w-\[(\d+)px\]/);
    const thumbWidth = pxOf(thumb.className, /w-\[(\d+)px\]/);
    const inset = pxOf(thumb.className, /left-\[(\d+)px\]/);
    const tokens = readFileSync('src/renderer/styles/tokens.css', 'utf8');
    const travel = Number(
      tokens.match(/--ui-toggle-travel:\s*(\d+)px/)?.[1] ?? NaN,
    );

    expect(travel).toBe(trackWidth - thumbWidth - inset * 2);

    const px = (name: string): number => {
      const raw = tokens.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1]?.trim();
      if (!raw) return NaN;
      const alias = raw.match(/^var\((--[\w-]+)\)$/);
      if (alias) return px(alias[1]);
      return Number(raw.match(/(\d+)px/)?.[1] ?? NaN);
    };
    expect(px('--ui-toggle-thumb-size')).toBe(thumbWidth);
    expect(px('--ui-toggle-press-height')).toBeLessThan(thumbWidth);

    // 눌림은 scale이 만들고 반지름을 축별 배율로 나눠 되돌려 캡슐을 지킨다.
    // 배율이 press-height ÷ thumb-size에서 어긋나면 눌린 노브가 타원으로 무너진다
    const scaleY = Number(
      tokens.match(new RegExp('--ui-toggle-press-scale-y: *([0-9.]+)'))?.[1] ??
        NaN,
    );
    expect(scaleY).toBeCloseTo(
      px('--ui-toggle-press-height') / px('--ui-toggle-thumb-size'),
      4,
    );

    const [, y1] =
      tokens
        .match(/--ui-toggle-ease:\s*cubic-bezier\(([^)]+)\)/)?.[1]
        .split(',')
        .map(Number) ?? [];
    const at = (t: number) =>
      3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t * t + t ** 3;
    let peak = 1;
    for (let t = 0; t <= 1; t += 0.005) peak = Math.max(peak, at(t));
    expect((peak - 1) * travel).toBeLessThanOrEqual(inset);
  });
});
