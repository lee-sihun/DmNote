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
import { isSameAspect } from './aspectResize';
import { isBoundsWithinEditorLimits } from './resizeLimits';
import { EDITOR_BOUNDS_LIMITS } from '@src/types/editor';
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

  it.each([false, true])(
    '회전된 리사이즈는 최종 저장 좌표 한계 안에서 멈춘다 (비율 고정 %s)',
    async (keepAspect) => {
      const onResize = vi.fn();
      await act(async () => {
        root.render(
          <ResizeHandles
            bounds={{
              x: -EDITOR_BOUNDS_LIMITS.maxAbsCoordinate + 10,
              y: 0,
              width: 100,
              height: 100,
            }}
            rotation={90}
            onResize={onResize}
          />,
        );
      });
      const handle = host.querySelector<HTMLElement>(
        '[data-resize-handle="e"]',
      )!;
      act(() =>
        handle.dispatchEvent(
          new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
        ),
      );
      document.dispatchEvent(
        new MouseEvent('mousemove', { clientY: 100, shiftKey: keepAspect }),
      );
      act(() => document.dispatchEvent(new MouseEvent('mouseup')));
      const result = onResize.mock.lastCall?.[0];
      expect(result).toBeDefined();
      expect(isBoundsWithinEditorLimits(result)).toBe(true);
      expect(result.x).toBeCloseTo(-EDITOR_BOUNDS_LIMITS.maxAbsCoordinate);
      expect(result.width).toBeCloseTo(120);
      expect(result.height).toBeCloseTo(keepAspect ? 120 : 100);
      expect(result.x + result.width / 2).toBeCloseTo(
        -EDITOR_BOUNDS_LIMITS.maxAbsCoordinate + 60,
      );
      expect(result.y + result.height / 2 - result.width / 2).toBeCloseTo(0);
      onResize.mockClear();
      await act(async () => {
        root.render(
          <ResizeHandles bounds={result} rotation={90} onResize={onResize} />,
        );
      });
      act(() =>
        handle.dispatchEvent(
          new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
        ),
      );
      document.dispatchEvent(
        new MouseEvent('mousemove', { clientY: 100, shiftKey: keepAspect }),
      );
      act(() => document.dispatchEvent(new MouseEvent('mouseup')));
      expect(onResize).not.toHaveBeenCalled();
    },
  );

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

  it('좌측 핸들은 비그리드 위치에서도 우측 앵커를 보존한다', async () => {
    const onResize = vi.fn();
    const bounds = { x: 103, y: 47, width: 50, height: 30 };
    await act(async () => {
      root.render(<ResizeHandles bounds={bounds} onResize={onResize} />);
    });
    const handle = host.querySelector<HTMLElement>('[data-resize-handle="w"]')!;
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
      new MouseEvent('mousemove', { clientX: -7, clientY: 0 }),
    );
    const callback = callbacks.get(1)!;
    callbacks.clear();
    act(() => callback(performance.now()));

    const result = onResize.mock.calls[0][0];
    expect(result).toMatchObject({ x: 100, y: 47, width: 53, height: 30 });
    expect(result.x + result.width).toBe(bounds.x + bounds.width);
    act(() => document.dispatchEvent(new MouseEvent('mouseup')));
  });

  it('상단 핸들은 비그리드 위치에서도 하단 앵커를 보존한다', async () => {
    const onResize = vi.fn();
    const bounds = { x: 103, y: 47, width: 50, height: 30 };
    await act(async () => {
      root.render(<ResizeHandles bounds={bounds} onResize={onResize} />);
    });
    const handle = host.querySelector<HTMLElement>('[data-resize-handle="n"]')!;
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
      new MouseEvent('mousemove', { clientX: 0, clientY: -8 }),
    );
    const callback = callbacks.get(1)!;
    callbacks.clear();
    act(() => callback(performance.now()));

    const result = onResize.mock.calls[0][0];
    expect(result).toMatchObject({ x: 103, y: 35, width: 50, height: 42 });
    expect(result.y + result.height).toBe(bounds.y + bounds.height);
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
    expect(visual.style.backgroundColor).toBe('white');
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
    expect(visual.style.backgroundColor).toBe('white');
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
    expect(visual.style.backgroundColor).toBe('white');
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

describe('ResizeHandles 자리 양보', () => {
  it('occupiedHandle 자리의 핸들은 그리지 않고 나머지 7개만 그린다', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <ResizeHandles
          bounds={{ x: 0, y: 0, width: 100, height: 100 }}
          occupiedHandle={{ x: 1, y: 0 }}
        />,
      );
    });
    expect(host.querySelector('[data-resize-handle="ne"]')).toBeNull();
    expect(host.querySelectorAll('[data-resize-handle]').length).toBe(7);
    await act(async () => root.unmount());
    host.remove();
  });
});

describe('ResizeHandles 비율 고정', () => {
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

  interface DragOptions {
    bounds: { x: number; y: number; width: number; height: number };
    lockAspect?: boolean;
    handle: string;
    dx: number;
    dy: number;
    shiftKey?: boolean;
  }

  // 그리드 스냅 5(store 기본값), 줌 1. 마지막 프리뷰 bounds를 돌려준다
  const drag = async ({
    bounds,
    lockAspect = false,
    handle,
    dx,
    dy,
    shiftKey = false,
  }: DragOptions) => {
    const onResize = vi.fn();
    const onResizeStart = vi.fn();
    await act(async () => {
      root.render(
        <ResizeHandles
          bounds={bounds}
          lockAspect={lockAspect}
          onResize={onResize}
          onResizeStart={onResizeStart}
        />,
      );
    });
    const element = host.querySelector<HTMLElement>(
      `[data-resize-handle="${handle}"]`,
    )!;
    act(() =>
      element.dispatchEvent(
        new MouseEvent('mousedown', {
          clientX: 0,
          clientY: 0,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    document.dispatchEvent(
      new MouseEvent('mousemove', { clientX: dx, clientY: dy, shiftKey }),
    );
    const callback = callbacks.get(1)!;
    callbacks.clear();
    act(() => callback(performance.now()));
    act(() => document.dispatchEvent(new MouseEvent('mouseup')));
    const last = onResize.mock.calls.at(-1)?.[0] as
      | (DragOptions['bounds'] & { aspect?: { primary: string } })
      | undefined;
    return { last, onResize, onResizeStart };
  };

  const thin = { x: 0, y: 0, width: 400, height: 0.1 };

  it('가로 핸들은 파생 높이에 하한을 먹이지 않고 비율을 지킨다', async () => {
    const { last } = await drag({
      bounds: thin,
      lockAspect: true,
      handle: 'e',
      dx: 10,
      dy: 0,
    });
    expect(last!.width).toBe(410);
    expect(last!.height).toBeCloseTo(0.1025, 12);
    expect(isSameAspect(thin, last!)).toBe(true);
    expect(last!.aspect?.primary).toBe('width');
  });

  it('세로 핸들 1px는 그리드 스냅이 0으로 무너져 스냅 없이 배율 11', async () => {
    const { last } = await drag({
      bounds: thin,
      lockAspect: true,
      handle: 's',
      dx: 0,
      dy: 1,
    });
    expect(last!.width).toBeCloseTo(4400, 9);
    expect(last!.height).toBeCloseTo(1.1, 12);
    expect(last!.x).toBeCloseTo(-2000, 9);
    expect(isSameAspect(thin, last!)).toBe(true);
  });

  it('세로 핸들 3px는 5로 스냅돼 배율 50', async () => {
    const { last } = await drag({
      bounds: thin,
      lockAspect: true,
      handle: 's',
      dx: 0,
      dy: 3,
    });
    expect(last!.width).toBeCloseTo(20000, 9);
    expect(last!.height).toBe(5);
    expect(last!.x).toBeCloseTo(-9800, 9);
  });

  it('상한에 닿으면 폭 32768에서 멈추고 백엔드 검증을 통과한다', async () => {
    const { last } = await drag({
      bounds: thin,
      lockAspect: true,
      handle: 's',
      dx: 0,
      dy: 100,
    });
    expect(last!.width).toBeLessThanOrEqual(32768);
    expect(last!.width).toBeGreaterThan(32767);
    expect(isBoundsWithinEditorLimits(last!)).toBe(true);
    expect(isSameAspect(thin, last!)).toBe(true);
  });

  it('왼쪽 핸들은 움직이는 가장자리를 스냅하고 오른쪽 가장자리를 고정한다', async () => {
    const start = { x: 3, y: 0, width: 200, height: 150 };
    // 폭 190 후보 → 왼쪽 가장자리 13 → 스냅 15 → 폭 188, 배율 0.94
    const { last } = await drag({
      bounds: start,
      lockAspect: true,
      handle: 'w',
      dx: 10,
      dy: 0,
    });
    expect(last).toMatchObject({ x: 15, width: 188 });
    expect(last!.height).toBeCloseTo(141, 12);
    expect(last!.y).toBeCloseTo(4.5, 12);
    expect(last!.x + last!.width).toBe(203);
  });

  it('Shift 비율 유지도 같은 경로를 탄다 (모서리는 변화 큰 축 기준)', async () => {
    const start = { x: 0, y: 0, width: 100, height: 100 };
    const { last } = await drag({
      bounds: start,
      handle: 'se',
      dx: 20,
      dy: 30,
      shiftKey: true,
    });
    expect(last).toMatchObject({ x: 0, y: 0, width: 130, height: 130 });
  });

  it('이미 상한 밖인 legacy 요소는 확대 드래그에 움직이지 않는다', async () => {
    const legacy = { x: 0, y: 0, width: 40000, height: 10 };
    const { onResize, onResizeStart } = await drag({
      bounds: legacy,
      lockAspect: true,
      handle: 'e',
      dx: 10,
      dy: 0,
    });
    expect(onResize).not.toHaveBeenCalled();
    expect(onResizeStart).not.toHaveBeenCalled();
  });

  it('연속 축소해도 하한 축이 10 아래로 반올림되지 않는다', async () => {
    // 100x77 을 왼쪽 핸들로 크게 줄이면 높이가 10에서 멈춘다. 그 결과를 다시 줄여도 그대로
    const first = await drag({
      bounds: { x: 0, y: 0, width: 100, height: 77 },
      lockAspect: true,
      handle: 'w',
      dx: 95,
      dy: 0,
    });
    expect(first.last!.height).toBeGreaterThanOrEqual(10);
    let bounds = { ...first.last! };
    for (let round = 0; round < 3; round += 1) {
      const next = await drag({
        bounds,
        lockAspect: true,
        handle: 'w',
        dx: 95,
        dy: 0,
      });
      if (next.last) bounds = { ...next.last };
      expect(bounds.height).toBeGreaterThanOrEqual(10);
      expect(bounds.width).toBeGreaterThan(12.9);
    }
  });
});
