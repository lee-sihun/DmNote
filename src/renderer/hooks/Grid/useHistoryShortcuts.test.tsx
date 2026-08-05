import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useHistoryShortcuts } from './useHistoryShortcuts';

vi.mock('@utils/core/platform', () => ({ isMac: () => true }));

interface HarnessProps {
  onUndo: () => void;
  onRedo: () => void;
}

const Harness = ({ onUndo, onRedo }: HarnessProps) => {
  useHistoryShortcuts({ onUndo, onRedo });
  return <button data-testid="target">대상</button>;
};

describe('useHistoryShortcuts', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  const renderHarness = async (onUndo: () => void, onRedo: () => void) => {
    await act(async () => {
      root.render(<Harness onUndo={onUndo} onRedo={onRedo} />);
    });
    return host.querySelector<HTMLButtonElement>('[data-testid="target"]')!;
  };

  it('상태 투영이 아직 갱신되지 않아도 Cmd+Z를 백엔드로 전달한다', async () => {
    const onUndo = vi.fn();
    const target = await renderHarness(onUndo, vi.fn());
    const event = new KeyboardEvent('keydown', {
      key: 'z',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });

    target.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(onUndo).toHaveBeenCalledOnce();
  });

  it('Cmd+Shift+Z도 최신 상태 판정을 백엔드에 맡긴다', async () => {
    const onRedo = vi.fn();
    const target = await renderHarness(vi.fn(), onRedo);
    const event = new KeyboardEvent('keydown', {
      key: 'z',
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });

    target.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(onRedo).toHaveBeenCalledOnce();
  });

  it('입력 필드의 native undo는 가로채지 않는다', async () => {
    const onUndo = vi.fn();
    await renderHarness(onUndo, vi.fn());
    const input = document.createElement('input');
    host.appendChild(input);
    const event = new KeyboardEvent('keydown', {
      key: 'z',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });

    input.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(onUndo).not.toHaveBeenCalled();
  });
});
