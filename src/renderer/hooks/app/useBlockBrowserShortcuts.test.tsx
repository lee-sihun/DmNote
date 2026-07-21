import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBlockBrowserShortcuts } from './useBlockBrowserShortcuts';

const Harness = ({ allowClose = false }: { allowClose?: boolean }) => {
  useBlockBrowserShortcuts({ allowCloseKeyPropagation: allowClose });
  return <button data-testid="target">대상</button>;
};

describe('useBlockBrowserShortcuts', () => {
  let host: HTMLDivElement;
  let root: Root;

  const renderHarness = async (allowClose = false) => {
    await act(async () => {
      root.render(<Harness allowClose={allowClose} />);
    });
    return host.querySelector<HTMLButtonElement>('[data-testid="target"]')!;
  };

  const shortcut = (
    key: string,
    options: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean } = {},
  ) =>
    new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ...options,
    });

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it('분리 창의 primary+W는 기본 동작만 막고 앱 핸들러로 전파한다', async () => {
    const target = await renderHarness(true);
    const appHandler = vi.fn();
    window.addEventListener('keydown', appHandler);
    const event = shortcut('w', { metaKey: true });
    target.dispatchEvent(event);
    window.removeEventListener('keydown', appHandler);

    expect(event.defaultPrevented).toBe(true);
    expect(appHandler).toHaveBeenCalledTimes(1);
  });

  it('primary+Shift+W는 분리 창에서도 전파 없이 차단한다', async () => {
    const target = await renderHarness(true);
    const appHandler = vi.fn();
    window.addEventListener('keydown', appHandler);
    const event = shortcut('w', { metaKey: true, shiftKey: true });
    target.dispatchEvent(event);
    window.removeEventListener('keydown', appHandler);

    expect(event.defaultPrevented).toBe(true);
    expect(appHandler).not.toHaveBeenCalled();
  });

  it('일반 창의 primary+W는 앱 핸들러까지 차단한다', async () => {
    const target = await renderHarness(false);
    const appHandler = vi.fn();
    window.addEventListener('keydown', appHandler);
    const event = shortcut('w', { metaKey: true });
    target.dispatchEvent(event);
    window.removeEventListener('keydown', appHandler);

    expect(event.defaultPrevented).toBe(true);
    expect(appHandler).not.toHaveBeenCalled();
  });

  it('F5 새로고침을 modifier와 무관하게 차단한다', async () => {
    const target = await renderHarness(true);
    const event = shortcut('F5');
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
