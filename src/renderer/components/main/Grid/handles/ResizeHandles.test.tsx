// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// macOS 커스텀 커서 경로 강제
vi.mock('@utils/core/platform', () => ({
  isMac: () => true,
}));

import {
  resumeCustomCursorHover,
  setCustomCursorHover,
  suspendCustomCursorHover,
} from '@utils/grid/cursorUtils';
import ResizeHandles from './ResizeHandles';

describe('ResizeHandles frame coalescing', () => {
  let host: HTMLDivElement;
  let root: Root;
  let callbacks: Map<number, FrameRequestCallback>;

  beforeEach(() => {
    callbacks = new Map();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.set(1, callback);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('mousemove burst의 최신 bounds만 한 번 preview한다', async () => {
    const onResize = vi.fn();
    await act(async () => {
      root.render(
        <ResizeHandles
          bounds={{ x: 0, y: 0, width: 100, height: 100 }}
          onResize={onResize}
        />,
      );
    });
    const handle = host.querySelector<HTMLElement>(
      '[data-resize-handle="se"]',
    )!;
    act(() =>
      handle.dispatchEvent(
        new MouseEvent('mousedown', {
          clientX: 0,
          clientY: 0,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );

    document.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 10, clientY: 10 }),
    );
    document.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 20, clientY: 30 }),
    );
    expect(onResize).not.toHaveBeenCalled();

    const callback = callbacks.get(1)!;
    callbacks.clear();
    act(() => callback(performance.now()));
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResize.mock.calls[0][0]).toMatchObject({
      width: 120,
      height: 130,
    });
    act(() => document.dispatchEvent(new MouseEvent('mouseup')));
  });

  it('가로 전용 핸들은 높이·Y를 유지한다 (비배수 높이 1px 밀림 방지)', async () => {
    const onResize = vi.fn();
    await act(async () => {
      root.render(
        <ResizeHandles
          bounds={{ x: 40, y: 40, width: 100, height: 63 }}
          onResize={onResize}
        />,
      );
    });
    const handle = host.querySelector<HTMLElement>('[data-resize-handle="e"]')!;
    act(() =>
      handle.dispatchEvent(
        new MouseEvent('mousedown', {
          clientX: 0,
          clientY: 0,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    document.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 10, clientY: 0 }),
    );
    const callback = callbacks.get(1)!;
    callbacks.clear();
    act(() => callback(performance.now()));
    expect(onResize).toHaveBeenCalledTimes(1);
    // 드래그하지 않은 축은 스냅 대상이 아니다 - 높이 63과 Y가 그대로여야 한다
    expect(onResize.mock.calls[0][0]).toMatchObject({
      x: 40,
      y: 40,
      width: 110,
      height: 63,
    });
    act(() => document.dispatchEvent(new MouseEvent('mouseup')));
  });

  it('세로 전용 핸들은 너비·X를 유지한다', async () => {
    const onResize = vi.fn();
    await act(async () => {
      root.render(
        <ResizeHandles
          bounds={{ x: 40, y: 40, width: 63, height: 100 }}
          onResize={onResize}
        />,
      );
    });
    const handle = host.querySelector<HTMLElement>('[data-resize-handle="s"]')!;
    act(() =>
      handle.dispatchEvent(
        new MouseEvent('mousedown', {
          clientX: 0,
          clientY: 0,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    document.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 0, clientY: 10 }),
    );
    const callback = callbacks.get(1)!;
    callbacks.clear();
    act(() => callback(performance.now()));
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResize.mock.calls[0][0]).toMatchObject({
      x: 40,
      y: 40,
      width: 63,
      height: 110,
    });
    act(() => document.dispatchEvent(new MouseEvent('mouseup')));
  });

  it('mouseup은 예약된 마지막 bounds를 flush한다', async () => {
    const onResize = vi.fn();
    const onResizeEnd = vi.fn();
    await act(async () => {
      root.render(
        <ResizeHandles
          bounds={{ x: 0, y: 0, width: 100, height: 100 }}
          onResize={onResize}
          onResizeEnd={onResizeEnd}
        />,
      );
    });
    const handle = host.querySelector<HTMLElement>(
      '[data-resize-handle="se"]',
    )!;
    act(() =>
      handle.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    document.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 25, clientY: 15 }),
    );

    act(() => document.dispatchEvent(new MouseEvent('mouseup')));

    expect(callbacks.size).toBe(0);
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResizeEnd).toHaveBeenCalledTimes(1);
  });
});

describe('ResizeHandles 핸들 호버 생명주기', () => {
  let host: HTMLDivElement;
  let root: Root;

  const CURSOR_BODY_CLASS = 'dmn-custom-cursor';

  const hasCursorBodyClass = () =>
    document.body.classList.contains(CURSOR_BODY_CLASS);

  // React의 enter/leave 합성은 over/out 이벤트에서 파생됨
  const dispatchEnter = (target: Element) =>
    target.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));

  const dispatchLeave = (target: Element) =>
    target.dispatchEvent(
      new PointerEvent('pointerout', {
        bubbles: true,
        relatedTarget: document.body,
      }),
    );

  const renderHandles = async (
    bounds: { x: number; y: number; width: number; height: number } | null,
  ) => {
    await act(async () => {
      root.render(<ResizeHandles bounds={bounds} />);
    });
  };

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    // 억제 상태와 호버 잔여분 원복 (resume은 한 태스크 뒤 해제)
    resumeCustomCursorHover();
    await new Promise((resolve) => setTimeout(resolve, 0));
    setCustomCursorHover(null);
  });

  it('pointer enter가 호버 커서를 켜고 leave가 끈다', async () => {
    await renderHandles({ x: 0, y: 0, width: 100, height: 100 });
    const handle = host.querySelector<HTMLElement>('[data-resize-handle="n"]')!;

    await act(async () => {
      dispatchEnter(handle);
    });
    expect(hasCursorBodyClass()).toBe(true);

    await act(async () => {
      dispatchLeave(handle);
    });
    expect(hasCursorBodyClass()).toBe(false);
  });

  it('드래그 세션 억제 중에는 enter가 무시된다', async () => {
    await renderHandles({ x: 0, y: 0, width: 100, height: 100 });
    const handle = host.querySelector<HTMLElement>('[data-resize-handle="s"]')!;

    suspendCustomCursorHover();
    await act(async () => {
      dispatchEnter(handle);
    });

    expect(hasCursorBodyClass()).toBe(false);
    // 시각적 호버 상태도 켜지지 않음
    const visual = handle.firstElementChild as HTMLElement;
    expect(visual.style.backgroundColor).toBe('var(--ui-handle-fill)');
  });

  it('억제 중 enter는 resume 시 hover로 적용된다', async () => {
    await renderHandles({ x: 0, y: 0, width: 100, height: 100 });
    const handle = host.querySelector<HTMLElement>('[data-resize-handle="s"]')!;

    suspendCustomCursorHover();
    await act(async () => {
      dispatchEnter(handle);
    });
    expect(hasCursorBodyClass()).toBe(false);

    resumeCustomCursorHover();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // 포인터가 핸들 안에 머문 릴리즈 - 커서와 하이라이트 모두 복원
    expect(hasCursorBodyClass()).toBe(true);
    const visual = handle.firstElementChild as HTMLElement;
    expect(visual.style.backgroundColor).not.toBe('white');
  });

  it('억제 중 enter 후 leave가 오면 resume에도 hover가 없다', async () => {
    await renderHandles({ x: 0, y: 0, width: 100, height: 100 });
    const handle = host.querySelector<HTMLElement>('[data-resize-handle="s"]')!;

    suspendCustomCursorHover();
    await act(async () => {
      dispatchEnter(handle);
      dispatchLeave(handle);
    });

    resumeCustomCursorHover();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(hasCursorBodyClass()).toBe(false);
    const visual = handle.firstElementChild as HTMLElement;
    expect(visual.style.backgroundColor).toBe('var(--ui-handle-fill)');
  });

  it('보류 중 핸들이 unmount되면 pending도 정리한다', async () => {
    await renderHandles({ x: 0, y: 0, width: 100, height: 100 });
    const handle = host.querySelector<HTMLElement>('[data-resize-handle="s"]')!;

    suspendCustomCursorHover();
    await act(async () => {
      dispatchEnter(handle);
    });

    // bounds 제거로 핸들 unmount (leave 이벤트 없음)
    await renderHandles(null);
    resumeCustomCursorHover();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(hasCursorBodyClass()).toBe(false);
  });

  it('호버 중 핸들이 unmount되면 커서 오버레이를 정리한다', async () => {
    await renderHandles({ x: 0, y: 0, width: 100, height: 100 });
    const handle = host.querySelector<HTMLElement>('[data-resize-handle="n"]')!;

    await act(async () => {
      dispatchEnter(handle);
    });
    expect(hasCursorBodyClass()).toBe(true);

    // bounds 제거로 핸들 unmount (leave 이벤트 없음)
    await renderHandles(null);
    expect(hasCursorBodyClass()).toBe(false);
  });
});
