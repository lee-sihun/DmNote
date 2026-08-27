/**
 * 팝업 포커스 복원의 재시도 계약
 * - 닫힌 직후 사용자가 다른 곳을 잡았으면 한 프레임 뒤 opener가 포커스를 뺏지 않는다
 * - 닫히다 다시 열리면 예약된 재시도를 버린다
 * - inert 해제가 한 프레임 늦은 opener는 그 프레임에 복원된다
 */
import React, { act, useLayoutEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useFocusRestore } from './useFocusRestore';

const Popup = ({ open }: { open: boolean }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { captureOpener } = useFocusRestore(open);
  useLayoutEffect(() => {
    if (open && containerRef.current) captureOpener(containerRef.current);
  }, [open, captureOpener]);
  if (!open) return null;
  return (
    <div ref={containerRef}>
      <button type="button" data-testid="inside">
        inside
      </button>
    </div>
  );
};

describe('useFocusRestore 재시도', () => {
  let host: HTMLDivElement;
  let root: Root;
  let opener: HTMLButtonElement;
  let frames: FrameRequestCallback[];

  const runFrames = () => {
    const queued = frames.splice(0);
    act(() => queued.forEach((frame) => frame(performance.now())));
  };

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    frames = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((frame) => {
      frames.push(frame);
      return frames.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames[id - 1] = () => {};
    });
    opener = document.createElement('button');
    document.body.appendChild(opener);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    opener.remove();
    vi.restoreAllMocks();
  });

  const openFromOpener = () => {
    opener.focus();
    act(() => root.render(<Popup open />));
    const inside = host.querySelector<HTMLButtonElement>(
      '[data-testid="inside"]',
    )!;
    inside.focus();
    return inside;
  };

  it('닫힌 뒤 사용자가 다른 입력을 잡으면 재시도가 포커스를 뺏지 않는다', () => {
    openFromOpener();
    // 열린 동안 opener가 잠겨 즉시 복원이 실패하는 상황
    opener.setAttribute('inert', '');
    act(() => root.render(<Popup open={false} />));
    expect(frames).toHaveLength(1);

    const other = document.createElement('input');
    document.body.appendChild(other);
    other.focus();
    opener.removeAttribute('inert');
    runFrames();

    expect(document.activeElement).toBe(other);
    other.remove();
  });

  it('닫히다 다시 열리면 예약된 재시도를 버린다', () => {
    const inside = openFromOpener();
    opener.setAttribute('inert', '');
    act(() => root.render(<Popup open={false} />));
    expect(frames).toHaveLength(1);

    act(() => root.render(<Popup open />));
    const reopened = host.querySelector<HTMLButtonElement>(
      '[data-testid="inside"]',
    )!;
    reopened.focus();
    opener.removeAttribute('inert');
    runFrames();

    expect(document.activeElement).toBe(reopened);
    expect(inside.isConnected).toBe(false);
  });

  it('inert 해제가 한 프레임 늦은 opener는 그 프레임에 복원된다', () => {
    openFromOpener();
    opener.setAttribute('inert', '');
    act(() => root.render(<Popup open={false} />));
    expect(document.activeElement).not.toBe(opener);

    opener.removeAttribute('inert');
    runFrames();

    expect(document.activeElement).toBe(opener);
  });
});
