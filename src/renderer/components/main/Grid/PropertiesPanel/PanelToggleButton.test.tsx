// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import PanelToggleButton from './PanelToggleButton';

describe('PanelToggleButton visual-first toggle', () => {
  let host: HTMLDivElement;
  let root: Root;
  let frame: FrameRequestCallback | null;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    frame = null;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('버튼 상태를 즉시 바꾸고 무거운 패널 commit은 paint 뒤에 실행한다', () => {
    const onClick = vi.fn();
    act(() =>
      root.render(<PanelToggleButton open={false} onClick={onClick} />),
    );
    const button = host.querySelector('button')!;

    act(() => button.click());
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(onClick).not.toHaveBeenCalled();
    act(() => {
      (frame as FrameRequestCallback)(performance.now());
      vi.runAllTimers();
    });
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('같은 프레임 두 번 토글은 원래 상태로 병합해 패널을 마운트하지 않는다', () => {
    const onClick = vi.fn();
    act(() =>
      root.render(<PanelToggleButton open={false} onClick={onClick} />),
    );
    const button = host.querySelector('button')!;

    act(() => {
      button.click();
      button.click();
    });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    act(() => {
      (frame as FrameRequestCallback)(performance.now());
      vi.runAllTimers();
    });
    expect(onClick).not.toHaveBeenCalled();
  });
});
